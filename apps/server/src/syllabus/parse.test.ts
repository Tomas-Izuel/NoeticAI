import { test, expect } from "bun:test";

// Mirrored copy of the salvage logic for unit tests. If the real impl ever
// gets exported from ./job.ts, replace this with a real import.

function trySalvageTruncatedJson(text: string): string | null {
  const closes: number[] = [];
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
      /* try earlier */
    }
  }
  return null;
}

function computeClosingBrackets(head: string): string | null {
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

test("salvage drops a half-written concept (cut mid-key)", () => {
  const truncated = `{"subject":{"name":"X"},"units":[{"order":1,"name":"U1","concepts":[{"order":1,"name":"A"},{"order":2,"name":"B"},{"order":3,"n`;
  const out = trySalvageTruncatedJson(truncated);
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out!) as {
    units: Array<{ name: string; concepts: Array<{ name: string }> }>;
  };
  const concepts = parsed.units[0]!.concepts;
  expect(concepts.map((c) => c.name)).toEqual(["A", "B"]);
});

test("salvage cut mid-string with no later complete `}` returns partial JSON", () => {
  const truncated = `{"subject":{"name":"X"},"units":[{"order":1,"name":"U1","concepts":[{"order":1,"name":"Cohe`;
  const out = trySalvageTruncatedJson(truncated);
  // The subject's closing `}` is the only complete brace — salvage returns
  // just the subject. Real callers will then fail zod validation on missing
  // units, which is the correct signal.
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out!) as { subject: { name: string } };
  expect(parsed.subject.name).toBe("X");
});

test("salvage keeps multi-unit progress", () => {
  const truncated = `{"subject":{"name":"X"},"units":[{"order":1,"name":"U1","concepts":[{"order":1,"name":"A"}]},{"order":2,"name":"U`;
  const out = trySalvageTruncatedJson(truncated);
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out!) as { units: Array<{ name: string }> };
  expect(parsed.units).toHaveLength(1);
  expect(parsed.units[0]!.name).toBe("U1");
});

test("salvage parses an already-complete JSON unchanged", () => {
  const complete = `{"subject":{"name":"X"},"units":[]}`;
  const out = trySalvageTruncatedJson(complete);
  expect(out).not.toBeNull();
  expect(JSON.parse(out!)).toEqual({ subject: { name: "X" }, units: [] });
});

test("salvage returns null for empty input", () => {
  expect(trySalvageTruncatedJson("")).toBeNull();
});

test("salvage handles braces inside strings correctly", () => {
  const truncated = `{"subject":{"name":"foo {bar} baz"},"units":[{"order":1,"name":"U1","concepts":[`;
  const out = trySalvageTruncatedJson(truncated);
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out!) as { subject: { name: string }; units: unknown[] };
  expect(parsed.subject.name).toBe("foo {bar} baz");
});
