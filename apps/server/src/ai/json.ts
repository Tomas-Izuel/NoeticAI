import { z } from "zod";

/**
 * Lenient LLM-JSON parser. Used by the syllabus extractor (Opus) and the
 * Phase 3 Haiku verdict step. Centralising here so a behaviour change is
 * applied to both call sites at once.
 *
 * Behaviour:
 *   1. Strip ```json ... ``` or ``` ... ``` fences if present.
 *   2. Try a direct JSON.parse on the (possibly stripped) text.
 *   3. Fall back to the outermost {…} or […] block.
 *   4. Fall back to the depth-aware truncation salvage (synthesises closing
 *      brackets for cut-mid-output responses; see syllabus/job.ts comment).
 *   5. Throw with a head/tail snippet for diagnosis.
 *
 * Strict on Bedrock / production: the leniency layers mask prompt-contract
 * drift. Re-evaluate after the AWS cutover (prod-changes.md §1).
 */
export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): T {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Track the most recent zod error so we can surface it if every parse path
  // produces parseable-but-schema-invalid JSON. Without this, schema mismatches
  // get swallowed and re-emerge as "could not be parsed" — misleading when
  // tuning prompts.
  let lastZodError: z.ZodError | null = null;

  // Try a direct parse first.
  try {
    const parsed: unknown = JSON.parse(text);
    return schema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) lastZodError = err;
    // Outermost {…} or […] block — works for both object- and array-rooted
    // LLM outputs (verdict response is an array; syllabus response is an object).
    const match = text.match(/[\{\[][\s\S]*[\}\]]/);
    if (match && match[0]) {
      try {
        const parsed: unknown = JSON.parse(match[0]);
        return schema.parse(parsed);
      } catch (err2) {
        if (err2 instanceof z.ZodError) lastZodError = err2;
      }
    }
    // Truncation salvage: depth-aware close. Walks the JSON tracking nesting
    // and string state, finds the longest valid prefix, and synthesises the
    // closing brackets/braces. Dev safety net — `prod-changes.md` notes the
    // removal once we're on Bedrock + Opus/Haiku.
    const salvaged = trySalvageTruncatedJson(text);
    if (salvaged) {
      try {
        const parsed: unknown = JSON.parse(salvaged);
        return schema.parse(parsed);
      } catch (err3) {
        if (err3 instanceof z.ZodError) lastZodError = err3;
      }
    }
    if (lastZodError) {
      const issues = lastZodError.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new Error(
        `LLM response parsed as JSON but failed schema validation. ` +
          `issues=[${issues}]. ` +
          `length=${raw.length}. ` +
          `head=${JSON.stringify(raw.slice(0, 200))}. ` +
          `tail=${JSON.stringify(raw.slice(-200))}.`,
      );
    }
    throw new Error(
      `LLM response could not be parsed as JSON. ` +
        `length=${raw.length}. ` +
        `head=${JSON.stringify(raw.slice(0, 200))}. ` +
        `tail=${JSON.stringify(raw.slice(-200))}.`,
    );
  }
}

export function trySalvageTruncatedJson(text: string): string | null {
  // Walk the text once, collecting every position right after a `}` that's
  // not inside a string — those are the only "between-fields" cuts we can
  // close cleanly. Then iterate them right-to-left (longest prefix first),
  // synthesise the closing sequence, and return the first one that parses.
  //
  // Implementation: O(n) for collection, then O(k) closes per attempt where
  // k = nesting depth. Total work is bounded by the JSON depth × number of
  // closing braces, which is fine for syllabus-sized payloads.

  const closes: number[] = []; // positions one-past the `}`
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "}") closes.push(i + 1);
  }

  for (let idx = closes.length - 1; idx >= 0; idx -= 1) {
    const cut = closes[idx]!;
    const head = text.slice(0, cut);
    const tail = computeClosingBrackets(head);
    if (tail === null) continue;
    const candidate = head + tail;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try an earlier cut.
    }
  }
  return null;
}

export function computeClosingBrackets(head: string): string | null {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      if (stack.length === 0) return null;
      stack.pop();
    }
  }
  if (inString) return null;
  return stack
    .reverse()
    .map((c) => (c === "{" ? "}" : "]"))
    .join("");
}
