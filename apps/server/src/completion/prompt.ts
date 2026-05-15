import { createHash } from "node:crypto";
import { subjectContextKey, conceptContextKey } from "@noeticai/ai";
import type { RetrievedChunk } from "./retrieve";

export interface CompletionPromptInput {
  subjectName: string;
  subjectCourse: string | null;
  syllabusExcerpt: string;
  syllabusVersion: number;
  thresholdsHash: string;
  conceptId: string;
  conceptUpdatedAtEpoch: number;
  conceptName: string;
  conceptLearningObjective: string | null;
  neighborhoodNames: string[];
  retrievedChunks: RetrievedChunk[];
  subjectId: string;
}

export interface CompletionPromptOutput {
  system: string;
  layeredContext: {
    subject: string;
    concept: string;
    userTurn: string;
  };
  promptHash: string;
  cacheKeys: {
    subject: string;
    concept: string;
  };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * System prompt — constant across all completions.
 * Cached at the "system" cachePoint layer (stable for an entire deploy).
 */
const SYSTEM_PROMPT = `You are completing a missing concept entry for a student's notes.
Given subject context, concept context, and a set of source passages,
draft 2–3 paragraphs introducing the concept.

Hard rules:
- Every paragraph MUST cite at least one source. Place the supporting chunk_ids
  in that paragraph's "sourceIds" array.
- DO NOT put chunk_ids inside the "text" field. No square-bracket markers,
  no parenthetical IDs — the prose must be clean. The renderer attaches the
  visible citation chips from the "sourceIds" array.
- Only use chunk_ids that appear in the SOURCES section verbatim. Never invent ids.
- Do not paraphrase or assert anything that is not directly supported by a chunk.
- If you cannot find supporting passages for the concept, return
  {"summary": null, "paragraphs": [], "confidence": 0.0}.
- Prose style: clear, scholarly, suitable for inclusion in study notes.
- Output: a single JSON object, no markdown, no commentary.

Language:
- Write the prose values ("summary" string, each paragraph's "text" string) in
  the SAME LANGUAGE as the SOURCES and the concept name. If the sources are in
  Spanish, write Spanish prose. If they are in English, write English prose.
  Never translate the sources into a different language.
- Keep all JSON KEYS in English exactly as shown in the schema below
  ("summary", "paragraphs", "text", "sourceIds", "confidence"). Do not
  translate keys.
- chunk_id strings in "sourceIds" stay verbatim — never translated.

Output schema (every field is REQUIRED for every paragraph):
{
  "summary": string | null,
  "paragraphs": [
    { "text": string, "sourceIds": [string, ...] }
  ],
  "confidence": number  // 0.0 to 1.0
}

Example of a correct paragraph object (illustrative; your actual output
language must match the SOURCES, not the language of this example):
{
  "text": "Coherentism holds that justification is a property of belief sets, not individual beliefs. A belief is justified iff it fits within a coherent web of supporting beliefs.",
  "sourceIds": ["abc123def456...", "ghi789jkl012..."]
}

Note that the example text contains zero square brackets and zero chunk_id strings.`;

/**
 * Builds the subject layer (cached per-subject across all concepts for a subject).
 * Format is stable and deterministic — same input always produces same string.
 * Contains: subject name, course (if set), syllabus version.
 * The syllabus_excerpt belongs to the concept layer (it is concept-specific).
 */
function buildSubjectLayer(input: CompletionPromptInput): string {
  const parts: string[] = [];
  parts.push(`SUBJECT`);
  parts.push(`name: ${input.subjectName}`);
  if (input.subjectCourse) {
    parts.push(`course: ${input.subjectCourse}`);
  }
  parts.push(`syllabus_version: ${input.syllabusVersion}`);
  return parts.join("\n");
}

/**
 * Builds the concept layer (cached per-concept, invalidated when concept changes).
 */
function buildConceptLayer(input: CompletionPromptInput): string {
  return [
    `CONCEPT`,
    `name: ${input.conceptName}`,
    `learning_objective: ${input.conceptLearningObjective ?? "(none)"}`,
    `neighbors: ${input.neighborhoodNames.join(", ") || "(none)"}`,
    `syllabus_excerpt: ${input.syllabusExcerpt}`,
  ].join("\n");
}

/**
 * Builds the user turn (never cached — changes per call with retrieved chunks).
 */
function buildUserTurn(chunks: RetrievedChunk[]): string {
  const sourcesBlock = chunks
    .map(
      (c) =>
        `[${c.chunkId}] ${c.sourceAuthor ?? ""} ${c.sourceTitle} ${c.pagesLabel ?? ""}`.trimEnd() +
        `\n${c.text}`,
    )
    .join("\n\n");

  return [
    `SOURCES (use the chunk_id verbatim when citing):`,
    sourcesBlock,
    ``,
    `TASK`,
    `Draft 2–3 paragraphs introducing this concept, suitable for inclusion in the user's notes. Output the JSON object now.`,
  ].join("\n");
}

/**
 * Builds the full layered completion prompt.
 *
 * promptHash = sha256(system + subject + concept).slice(0, 24)
 * Note: the hash does NOT include retrieved chunks — so the same concept
 * produces the same hash regardless of which chunks were retrieved.
 * This is intentional: the hash identifies "cache identity" for deduplication,
 * not retrieval identity.
 */
export function buildCompletionPrompt(
  input: CompletionPromptInput,
): CompletionPromptOutput {
  const system = SYSTEM_PROMPT;
  const subject = buildSubjectLayer(input);
  const concept = buildConceptLayer(input);
  const userTurn = buildUserTurn(input.retrievedChunks);

  const promptHash = sha256Hex(system + subject + concept).slice(0, 24);

  const subjectKey = subjectContextKey({
    subjectId: input.subjectId,
    syllabusVersion: input.syllabusVersion,
    thresholdsHash: input.thresholdsHash,
  });

  const conceptKey = conceptContextKey({
    conceptId: input.conceptId,
    version: input.conceptUpdatedAtEpoch,
  });

  return {
    system,
    layeredContext: {
      subject,
      concept,
      userTurn,
    },
    promptHash,
    cacheKeys: {
      subject: subjectKey,
      concept: conceptKey,
    },
  };
}

/**
 * Compute a prompt hash from raw prompt layer strings.
 * Exported for use in tests.
 */
export function computePromptHash(system: string, subject: string, concept: string): string {
  return sha256Hex(system + subject + concept).slice(0, 24);
}
