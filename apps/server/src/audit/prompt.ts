import type { ConceptFragmentVerdict } from "@noeticai/audit-core";

export interface VerdictCandidate {
  id: string;        // fragment id
  text: string;      // raw fragment text (trimmed if > 800 chars)
}

export interface VerdictBatchInput {
  conceptName: string;
  conceptLearningObjective: string | null;
  candidates: VerdictCandidate[];
}

export interface VerdictBatchOutputItem {
  id: string;
  verdict: ConceptFragmentVerdict;
}

/**
 * Returns { system, user } strings to feed into llm.haiku().
 * The system prompt is short and constant — Bedrock cache-friendly when
 * caching lands (Phase 5). The user prompt embeds the candidate JSON.
 *
 * Trims each candidate's text to 800 characters before stringifying —
 * keeps the prompt under ~16K input tokens for a 20-candidate batch.
 */
export function buildVerdictPrompt(input: VerdictBatchInput): {
  system: string;
  user: string;
} {
  const system = `You classify paragraph candidates against one concept.

Output: ONE JSON array. Nothing else.
- No prose. No markdown. No code fences. No commentary.
- The KEYS are the literal strings "id" and "verdict" — do not translate.
- One object per input candidate, in the same order. Do not invent ids.
- Each "verdict" is exactly one of: "engages", "mentions", "tangential", "off-topic".

Verdict definitions:
- "engages": the paragraph explains, defines, or substantively works through the concept.
- "mentions": the paragraph names or briefly references the concept without unpacking it.
- "tangential": the paragraph is in the same topical neighborhood but does not address the concept.
- "off-topic": the paragraph is unrelated to the concept.

Example output (for two candidates):
[{"id":"frag-a1","verdict":"engages"},{"id":"frag-b2","verdict":"off-topic"}]

Begin output with the opening "[" and end with the closing "]". Nothing before, nothing after.`;

  const trimmedCandidates = input.candidates.map((c) => ({
    id: c.id,
    text: c.text.length > 800 ? c.text.slice(0, 800) : c.text,
  }));

  const user = `CONCEPT
name: ${input.conceptName}
learning_objective: ${input.conceptLearningObjective ?? "(none)"}

CANDIDATES (${trimmedCandidates.length} items, classify every one):
${JSON.stringify(trimmedCandidates)}

Return the JSON array now. Begin with "[".`;

  return { system, user };
}
