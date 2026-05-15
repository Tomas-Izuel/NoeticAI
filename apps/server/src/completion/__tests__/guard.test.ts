/**
 * Unit tests for the hallucination guard (guard.ts).
 *
 * All 7 guard steps are exercised. The EmbedClient is a fake that returns
 * configurable vectors — no live embed or LLM calls.
 *
 * Run with: bun test src/completion/__tests__/guard.test.ts
 */

import { test, expect } from "bun:test";
import type { EmbedClient, EmbedArgs, EmbedResult } from "@noeticai/ai";
import { runGuard } from "../guard";
import type { RetrievedChunk } from "../retrieve";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal RetrievedChunk fixture. */
function makeChunk(chunkId: string, text = "Source text for chunk."): RetrievedChunk {
  return {
    chunkId,
    sourceId: `src-${chunkId}`,
    sourceTitle: "Test Source",
    sourceAuthor: "Author",
    sourceYear: 2024,
    position: 1,
    chapterLabel: null,
    pagesLabel: null,
    text,
    retrievalSimilarity: 0.9,
  };
}

/**
 * Build a fake EmbedClient that returns vectors with a configurable cosine.
 *
 * The fake always returns pairs: for a 2-text embed call, it returns:
 *   - [vectorA, vectorB] where cosineSim(vectorA, vectorB) === cosineValue
 *
 * We achieve this by returning:
 *   vectorA = [1, 0, 0, ...]
 *   vectorB = [cosineValue, sqrt(1 - cosineValue^2), 0, ...]
 * These are unit vectors with dot product = cosineValue.
 */
function makeEmbedClient(cosineValue: number, dim = 4): EmbedClient {
  const vectorA = Array(dim).fill(0) as number[];
  vectorA[0] = 1;

  const vectorB = Array(dim).fill(0) as number[];
  const clipped = Math.min(1, Math.max(-1, cosineValue));
  vectorB[0] = clipped;
  vectorB[1] = Math.sqrt(Math.max(0, 1 - clipped * clipped));

  return {
    defaultModelId: "test-embed-model",
    embed: async (_args: EmbedArgs): Promise<EmbedResult> => ({
      modelId: "test-embed-model",
      dim,
      vectors: [vectorA, vectorB],
    }),
  };
}

/**
 * Build a fake EmbedClient that returns different cosine values per call,
 * cycling through the provided array.
 */
function makeCyclingEmbedClient(cosines: number[], dim = 4): EmbedClient {
  let callCount = 0;
  return {
    defaultModelId: "test-embed-model",
    embed: async (_args: EmbedArgs): Promise<EmbedResult> => {
      const cosineValue = cosines[callCount % cosines.length] ?? 0.9;
      callCount++;

      const clipped = Math.min(1, Math.max(-1, cosineValue));
      const vectorA = Array(dim).fill(0) as number[];
      vectorA[0] = 1;
      const vectorB = Array(dim).fill(0) as number[];
      vectorB[0] = clipped;
      vectorB[1] = Math.sqrt(Math.max(0, 1 - clipped * clipped));

      return {
        modelId: "test-embed-model",
        dim,
        vectors: [vectorA, vectorB],
      };
    },
  };
}

const DEFAULT_THRESHOLDS = { hallucinationGuardSimilarity: 0.85, minConfidence: 0.85 };
const EMBED_MODEL_ID = "test-embed-model";

function makeGuardInput(
  llmOutput: string,
  chunks: RetrievedChunk[],
  embedClient: EmbedClient,
  thresholds = DEFAULT_THRESHOLDS,
) {
  return {
    llmOutput,
    retrievedChunks: chunks,
    thresholds,
    embedClient,
    embedModelId: EMBED_MODEL_ID,
  };
}

function validOutput(chunkIds: string[], confidence = 0.9): string {
  return JSON.stringify({
    summary: "A summary of the concept.",
    paragraphs: [
      { text: "First paragraph with citation.", sourceIds: chunkIds },
    ],
    confidence,
  });
}

// ---------------------------------------------------------------------------
// Step 1: Parse
// ---------------------------------------------------------------------------

test("step 1 — malformed JSON returns ok:false with parse error", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput("not valid json at all {{{", chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("JSON parse error");
  }
});

test("step 1 — schema mismatch (missing paragraphs field) returns ok:false", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({ summary: "ok", confidence: 0.9 }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
});

test("step 1 — confidence as string instead of number returns ok:false", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "ok",
        paragraphs: [{ text: "p", sourceIds: ["chunk-1"] }],
        confidence: "high",
      }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Step 2: Null short-circuit
// ---------------------------------------------------------------------------

test("step 2 — summary:null triggers null short-circuit", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({ summary: null, paragraphs: [], confidence: 0.0 }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("model returned null");
  }
});

test("step 2 — summary set but paragraphs empty triggers null short-circuit", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({ summary: "A summary.", paragraphs: [], confidence: 0.9 }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("model returned null");
  }
});

// ---------------------------------------------------------------------------
// Step 3: Citation count
// ---------------------------------------------------------------------------

test("step 3 — every paragraph has sourceIds:[] returns ok:false no citations", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [
          { text: "Para one.", sourceIds: [] },
          { text: "Para two.", sourceIds: [] },
        ],
        confidence: 0.9,
      }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("no citations");
  }
});

// ---------------------------------------------------------------------------
// Step 4: Citation allowlist
// ---------------------------------------------------------------------------

test("step 4 — cited id not in retrievedChunks returns fabricated citation", async () => {
  const chunks = [makeChunk("chunk-real")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [{ text: "Para.", sourceIds: ["chunk-real", "chunk-fake"] }],
        confidence: 0.9,
      }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("fabricated citation id chunk-fake");
  }
});

test("step 4 — all cited ids in retrievedChunks passes allowlist", async () => {
  const chunks = [makeChunk("chunk-a"), makeChunk("chunk-b")];
  // Re-similarity will be 0.9, above 0.85 threshold, so should pass all steps.
  const result = await runGuard(
    makeGuardInput(validOutput(["chunk-a", "chunk-b"]), chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Step 5: Confidence floor
// ---------------------------------------------------------------------------

test("step 5 — confidence 0.84 (below 0.85) returns ok:false", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(validOutput(["chunk-1"], 0.84), chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("confidence");
    expect(result.reason).toContain("0.84");
  }
});

test("step 5 — confidence exactly 0.85 (boundary) passes", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(validOutput(["chunk-1"], 0.85), chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Step 6: Re-similarity
// ---------------------------------------------------------------------------

test("step 6 — re-similarity 0.84 (below threshold) returns ok:false", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(validOutput(["chunk-1"]), chunks, makeEmbedClient(0.84)),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("max citation sim");
    expect(result.reason).toContain("< 0.85");
  }
});

test("step 6 — re-similarity exactly 0.85 (boundary) passes", async () => {
  const chunks = [makeChunk("chunk-1")];
  const result = await runGuard(
    makeGuardInput(validOutput(["chunk-1"], 0.85), chunks, makeEmbedClient(0.85)),
  );
  expect(result.ok).toBe(true);
});

test("step 6 — paragraph cites two chunks: one sim=0.92 other=0.40 → max=0.92 passes", async () => {
  const chunks = [makeChunk("chunk-hi"), makeChunk("chunk-lo")];
  // First embed call (chunk-hi) returns 0.92, second (chunk-lo) returns 0.40.
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [{ text: "Para.", sourceIds: ["chunk-hi", "chunk-lo"] }],
        confidence: 0.9,
      }),
      chunks,
      makeCyclingEmbedClient([0.92, 0.40]),
    ),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    // Max for paragraph 0 should reflect the highest sim.
    const simHi = result.citationSimilarities.get("0:chunk-hi");
    const simLo = result.citationSimilarities.get("0:chunk-lo");
    expect(simHi).toBeDefined();
    expect(simLo).toBeDefined();
    expect(simHi!).toBeGreaterThan(simLo!);
  }
});

test("step 6 — paragraph cites two chunks both below threshold → fails with paragraph index in reason", async () => {
  const chunks = [makeChunk("chunk-a"), makeChunk("chunk-b")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [{ text: "Para.", sourceIds: ["chunk-a", "chunk-b"] }],
        confidence: 0.9,
      }),
      chunks,
      makeCyclingEmbedClient([0.60, 0.55]),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("paragraph 0");
    expect(result.reason).toContain("max citation sim");
  }
});

// ---------------------------------------------------------------------------
// Step 7: Happy path (all checks pass)
// ---------------------------------------------------------------------------

test("happy path — all 7 steps pass → ok:true with correct fields", async () => {
  const chunks = [makeChunk("chunk-1", "Deep explanation of topic A."), makeChunk("chunk-2", "Further detail on topic B.")];
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A well-supported summary.",
        paragraphs: [
          { text: "Para one citing chunk one.", sourceIds: ["chunk-1"] },
          { text: "Para two citing chunk two.", sourceIds: ["chunk-2"] },
        ],
        confidence: 0.92,
      }),
      chunks,
      makeEmbedClient(0.91),
    ),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.summary).toBe("A well-supported summary.");
    expect(result.paragraphs).toHaveLength(2);
    expect(result.confidence).toBe(0.92);
    expect(result.citationSimilarities.size).toBe(2);
    expect(result.citationSimilarities.has("0:chunk-1")).toBe(true);
    expect(result.citationSimilarities.has("1:chunk-2")).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("edge — zero retrieved chunks: allowlist is empty, fabricated citation for any id", async () => {
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [{ text: "Para.", sourceIds: ["some-chunk"] }],
        confidence: 0.9,
      }),
      [],
      makeEmbedClient(0.9),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("fabricated citation id some-chunk");
  }
});

test("edge — empty paragraph text: embed still called, cosine computed", async () => {
  const chunks = [makeChunk("chunk-1")];
  // Empty paragraph text — embed returns valid vectors regardless.
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [{ text: "", sourceIds: ["chunk-1"] }],
        confidence: 0.9,
      }),
      chunks,
      makeEmbedClient(0.9),
    ),
  );
  // With high cosine the guard should pass even for empty text.
  expect(result.ok).toBe(true);
});

test("edge — markdown-fenced JSON is parsed correctly", async () => {
  const chunks = [makeChunk("chunk-1")];
  const inner = JSON.stringify({
    summary: "Fenced.",
    paragraphs: [{ text: "Para.", sourceIds: ["chunk-1"] }],
    confidence: 0.9,
  });
  const result = await runGuard(
    makeGuardInput("```json\n" + inner + "\n```", chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(true);
});

test("edge — multiple paragraphs, second paragraph's max sim is below threshold → fails", async () => {
  const chunks = [makeChunk("chunk-good"), makeChunk("chunk-bad")];
  // First paragraph gets 0.92, second gets 0.70.
  const result = await runGuard(
    makeGuardInput(
      JSON.stringify({
        summary: "A summary.",
        paragraphs: [
          { text: "Para one.", sourceIds: ["chunk-good"] },
          { text: "Para two.", sourceIds: ["chunk-bad"] },
        ],
        confidence: 0.9,
      }),
      chunks,
      makeCyclingEmbedClient([0.92, 0.70]),
    ),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain("paragraph 1");
  }
});

test("citationSimilarities map key format is paragraphIndex:chunkId", async () => {
  const chunks = [makeChunk("abc-123")];
  const result = await runGuard(
    makeGuardInput(validOutput(["abc-123"]), chunks, makeEmbedClient(0.9)),
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.citationSimilarities.has("0:abc-123")).toBe(true);
  }
});
