/**
 * Unit tests for buildCompletionPrompt (prompt.ts).
 *
 * Validates:
 *   - promptHash determinism on identical input
 *   - promptHash differs when subject/concept changes
 *   - promptHash does NOT change when retrievedChunks change (chunks are in userTurn, not hashed)
 *   - userTurn contains every retrieved chunkId
 *   - system contains the required "Output: a single JSON object" marker
 *   - cacheKeys.subject and cacheKeys.concept match the helper functions
 *   - subject layer contains subject name, course, syllabus_version, syllabus_excerpt
 *   - concept layer contains name, learning_objective, neighbors, syllabus_excerpt
 *
 * No LLM or embed calls — pure string-building tests.
 *
 * Run with: bun test src/completion/__tests__/prompt.test.ts
 */

import { test, expect } from "bun:test";
import { subjectContextKey, conceptContextKey } from "@noeticai/ai";
import { buildCompletionPrompt, computePromptHash } from "../prompt";
import type { RetrievedChunk } from "../retrieve";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(chunkId: string, text = "Chunk body text."): RetrievedChunk {
  return {
    chunkId,
    sourceId: `src-${chunkId}`,
    sourceTitle: "Test Book",
    sourceAuthor: "Test Author",
    sourceYear: 2024,
    position: 1,
    chapterLabel: null,
    pagesLabel: "p. 42",
    text,
    retrievalSimilarity: 0.88,
  };
}

function baseInput() {
  return {
    subjectId: "subj-001",
    subjectName: "Philosophy",
    subjectCourse: "PHI 101",
    syllabusExcerpt: "Introduction to epistemology.",
    syllabusVersion: 3,
    thresholdsHash: "abc123",
    conceptId: "cncpt-001",
    conceptUpdatedAtEpoch: 1_700_000_000_000,
    conceptName: "Rationalism",
    conceptLearningObjective: "Understand the rationalist tradition.",
    neighborhoodNames: ["Empiricism", "Idealism"],
    retrievedChunks: [makeChunk("chunk-a"), makeChunk("chunk-b")],
  };
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("promptHash is deterministic on identical input", () => {
  const input = baseInput();
  const result1 = buildCompletionPrompt(input);
  const result2 = buildCompletionPrompt(input);
  expect(result1.promptHash).toBe(result2.promptHash);
});

test("promptHash has length 24", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.promptHash).toHaveLength(24);
});

// ---------------------------------------------------------------------------
// Hash isolation — chunks must NOT affect the hash
// ---------------------------------------------------------------------------

test("promptHash does NOT change when retrievedChunks change", () => {
  const input1 = { ...baseInput(), retrievedChunks: [makeChunk("chunk-x")] };
  const input2 = { ...baseInput(), retrievedChunks: [makeChunk("chunk-y"), makeChunk("chunk-z")] };
  const result1 = buildCompletionPrompt(input1);
  const result2 = buildCompletionPrompt(input2);
  expect(result1.promptHash).toBe(result2.promptHash);
});

test("promptHash changes when subjectName changes", () => {
  const input1 = baseInput();
  const input2 = { ...baseInput(), subjectName: "Mathematics" };
  const result1 = buildCompletionPrompt(input1);
  const result2 = buildCompletionPrompt(input2);
  expect(result1.promptHash).not.toBe(result2.promptHash);
});

test("promptHash changes when conceptName changes", () => {
  const input1 = baseInput();
  const input2 = { ...baseInput(), conceptName: "Empiricism" };
  const result1 = buildCompletionPrompt(input1);
  const result2 = buildCompletionPrompt(input2);
  expect(result1.promptHash).not.toBe(result2.promptHash);
});

test("promptHash changes when syllabusExcerpt changes", () => {
  const input1 = baseInput();
  const input2 = { ...baseInput(), syllabusExcerpt: "Different excerpt content." };
  const result1 = buildCompletionPrompt(input1);
  const result2 = buildCompletionPrompt(input2);
  expect(result1.promptHash).not.toBe(result2.promptHash);
});

// ---------------------------------------------------------------------------
// computePromptHash standalone helper
// ---------------------------------------------------------------------------

test("computePromptHash is consistent with the inline hash in buildCompletionPrompt", () => {
  const result = buildCompletionPrompt(baseInput());
  const recomputed = computePromptHash(
    result.system,
    result.layeredContext.subject,
    result.layeredContext.concept,
  );
  expect(result.promptHash).toBe(recomputed);
});

// ---------------------------------------------------------------------------
// userTurn must contain retrieved chunkIds (never system or concept layers)
// ---------------------------------------------------------------------------

test("userTurn contains every retrieved chunkId", () => {
  const chunks = [makeChunk("chunk-abc"), makeChunk("chunk-def"), makeChunk("chunk-ghi")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  for (const chunk of chunks) {
    expect(result.layeredContext.userTurn).toContain(chunk.chunkId);
  }
});

test("system layer does NOT contain retrieved chunkIds", () => {
  const chunks = [makeChunk("chunk-abc")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  expect(result.system).not.toContain("chunk-abc");
});

test("subject layer does NOT contain retrieved chunkIds", () => {
  const chunks = [makeChunk("chunk-abc")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  expect(result.layeredContext.subject).not.toContain("chunk-abc");
});

test("concept layer does NOT contain retrieved chunkIds", () => {
  const chunks = [makeChunk("chunk-abc")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  expect(result.layeredContext.concept).not.toContain("chunk-abc");
});

// ---------------------------------------------------------------------------
// System prompt markers
// ---------------------------------------------------------------------------

test("system contains the 'Output: a single JSON object' marker", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.system).toContain("Output: a single JSON object");
});

test("system contains hard rules about citing source chunks", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.system).toContain("Every paragraph MUST cite at least one source");
});

test("system instructs the model to NOT put chunk ids inline in text", () => {
  // Guards against the original prompt-contract drift where gemma followed an
  // "inline markers" instruction and omitted the sourceIds array. The renderer
  // attaches visible chips from sourceIds; the model must keep text clean.
  const result = buildCompletionPrompt(baseInput());
  expect(result.system).toContain("DO NOT put chunk_ids inside the \"text\" field");
});

test("system instructs the model to match the source language for prose values", () => {
  // Same pattern as syllabus/prompt.ts: English system instructions + explicit
  // "match the source language for prose, keep JSON keys in English" — without
  // this, the completion comes out in English even on Spanish-first subjects.
  // (Spanish-first is the project default per Cohere multilingual v3 embedding.)
  const result = buildCompletionPrompt(baseInput());
  expect(result.system).toContain("SAME LANGUAGE as the SOURCES");
  expect(result.system).toContain("Keep all JSON KEYS in English");
});

test("system contains JSON schema shape", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.system).toContain("\"summary\"");
  expect(result.system).toContain("\"paragraphs\"");
  expect(result.system).toContain("\"confidence\"");
});

// ---------------------------------------------------------------------------
// Subject layer content
// ---------------------------------------------------------------------------

test("subject layer contains subject name", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.subject).toContain("Philosophy");
});

test("subject layer contains course when set", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.subject).toContain("PHI 101");
});

test("subject layer does not contain course line when course is null", () => {
  const result = buildCompletionPrompt({ ...baseInput(), subjectCourse: null });
  expect(result.layeredContext.subject).not.toContain("course:");
});

test("subject layer contains syllabus_version", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.subject).toContain("syllabus_version: 3");
});

// ---------------------------------------------------------------------------
// Concept layer content
// ---------------------------------------------------------------------------

test("concept layer contains concept name", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.concept).toContain("Rationalism");
});

test("concept layer contains learning_objective", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.concept).toContain("Understand the rationalist tradition.");
});

test("concept layer contains (none) when learning_objective is null", () => {
  const result = buildCompletionPrompt({ ...baseInput(), conceptLearningObjective: null });
  expect(result.layeredContext.concept).toContain("(none)");
});

test("concept layer contains neighbor names", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.concept).toContain("Empiricism");
  expect(result.layeredContext.concept).toContain("Idealism");
});

test("concept layer contains (none) for neighbors when neighborhoodNames is empty", () => {
  const result = buildCompletionPrompt({ ...baseInput(), neighborhoodNames: [] });
  expect(result.layeredContext.concept).toContain("(none)");
});

test("concept layer contains syllabus_excerpt", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.concept).toContain("Introduction to epistemology.");
});

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

test("cacheKeys.subject matches subjectContextKey()", () => {
  const input = baseInput();
  const result = buildCompletionPrompt(input);
  const expected = subjectContextKey({
    subjectId: input.subjectId,
    syllabusVersion: input.syllabusVersion,
    thresholdsHash: input.thresholdsHash,
  });
  expect(result.cacheKeys.subject).toBe(expected);
});

test("cacheKeys.concept matches conceptContextKey()", () => {
  const input = baseInput();
  const result = buildCompletionPrompt(input);
  const expected = conceptContextKey({
    conceptId: input.conceptId,
    version: input.conceptUpdatedAtEpoch,
  });
  expect(result.cacheKeys.concept).toBe(expected);
});

// ---------------------------------------------------------------------------
// userTurn format
// ---------------------------------------------------------------------------

test("userTurn contains SOURCES header and TASK header", () => {
  const result = buildCompletionPrompt(baseInput());
  expect(result.layeredContext.userTurn).toContain("SOURCES");
  expect(result.layeredContext.userTurn).toContain("TASK");
});

test("userTurn chunk entries contain [chunkId] prefix format", () => {
  const chunks = [makeChunk("my-chunk-001")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  expect(result.layeredContext.userTurn).toContain("[my-chunk-001]");
});

test("userTurn contains chunk text body", () => {
  const chunks = [makeChunk("chunk-x", "The specific text content of this chunk.")];
  const result = buildCompletionPrompt({ ...baseInput(), retrievedChunks: chunks });
  expect(result.layeredContext.userTurn).toContain("The specific text content of this chunk.");
});
