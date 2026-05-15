import { z } from "zod";
import { parseLlmJson } from "../ai/json";
import type { EmbedClient } from "@noeticai/ai";
import type { RetrievedChunk } from "./retrieve";

export interface GuardInput {
  llmOutput: string;
  retrievedChunks: RetrievedChunk[];
  thresholds: { hallucinationGuardSimilarity: number; minConfidence: number };
  embedClient: EmbedClient;
  embedModelId: string;
}

export type GuardResult =
  | {
      ok: true;
      summary: string;
      paragraphs: Array<{ text: string; sourceIds: string[] }>;
      confidence: number;
      // Re-similarity scores per (paragraphIndex, chunkId) — persisted to citations.similarity.
      // key: `${paragraphIndex}:${chunkId}`
      citationSimilarities: Map<string, number>;
    }
  | {
      ok: false;
      reason: string;
    };

// Zod schema for the LLM completion output.
const LLM_OUTPUT_SCHEMA = z.object({
  summary: z.string().nullable(),
  paragraphs: z.array(
    z.object({
      text: z.string(),
      sourceIds: z.array(z.string()),
    }),
  ),
  confidence: z.number(),
});

/**
 * Computes cosine similarity between two equal-length vectors.
 * Returns 0 if either vector has zero magnitude.
 */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Hallucination guard — the kill-criterion check for Phase 5.
 *
 * Runs 7 sequential fail-fast checks. Each returns { ok: false, reason } on
 * failure. All 7 must pass to return { ok: true, ... }.
 *
 * Steps:
 *   1. Parse LLM output with zod schema via parseLlmJson.
 *   2. Null short-circuit: summary === null or paragraphs.length === 0.
 *   3. Citation count: every paragraph has sourceIds: [].
 *   4. Citation allowlist: every cited chunkId must be in retrievedChunks.
 *   5. Confidence floor: confidence >= thresholds.minConfidence.
 *   6. Re-similarity: for each (paragraph, cited chunk) pair, embed both texts
 *      in one batched call and compute cosine. If any paragraph's max
 *      citation similarity < thresholds.hallucinationGuardSimilarity, fail.
 *   7. Return ok: true with citationSimilarities map.
 */
export async function runGuard(input: GuardInput): Promise<GuardResult> {
  // Step 1: Parse.
  let parsed: z.infer<typeof LLM_OUTPUT_SCHEMA>;
  try {
    parsed = parseLlmJson(input.llmOutput, LLM_OUTPUT_SCHEMA);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `JSON parse error: ${reason}` };
  }

  // Step 2: Null short-circuit.
  if (parsed.summary === null || parsed.paragraphs.length === 0) {
    return { ok: false, reason: "model returned null" };
  }

  // Step 3: Citation count — at least one paragraph must cite something.
  if (parsed.paragraphs.every((p) => p.sourceIds.length === 0)) {
    return { ok: false, reason: "no citations" };
  }

  // Step 4: Citation allowlist.
  const allowed = new Set(input.retrievedChunks.map((c) => c.chunkId));
  for (const paragraph of parsed.paragraphs) {
    for (const sourceId of paragraph.sourceIds) {
      if (!allowed.has(sourceId)) {
        return { ok: false, reason: `fabricated citation id ${sourceId}` };
      }
    }
  }

  // Step 5: Confidence floor.
  if (parsed.confidence < input.thresholds.minConfidence) {
    return {
      ok: false,
      reason: `confidence ${parsed.confidence} < ${input.thresholds.minConfidence}`,
    };
  }

  // Step 6: Re-similarity — embed each (paragraph, cited chunk) pair and
  // compute cosine similarity. Keep max per paragraph. Fail if any paragraph's
  // max is below the hallucinationGuardSimilarity threshold.
  //
  // Implementation: build a flat array of pairs, make one batched embed call
  // per pair (predictable batch size), then compute cosine from the returned
  // vectors. Avoids accumulating a very large batch while keeping all embed
  // calls after the allowlist check passes.
  const citationSimilarities = new Map<string, number>();

  // Build the list of (paragraphIndex, chunkId, paraText, chunkText) tuples
  // for paragraphs that cite at least one chunk.
  const pairs: Array<{
    paragraphIndex: number;
    chunkId: string;
    paraText: string;
    chunkText: string;
  }> = [];

  const chunkTextMap = new Map(input.retrievedChunks.map((c) => [c.chunkId, c.text]));

  for (let pi = 0; pi < parsed.paragraphs.length; pi++) {
    const paragraph = parsed.paragraphs[pi];
    if (!paragraph) continue;
    for (const chunkId of paragraph.sourceIds) {
      const chunkText = chunkTextMap.get(chunkId);
      if (chunkText === undefined) continue; // already caught by allowlist
      pairs.push({
        paragraphIndex: pi,
        chunkId,
        paraText: paragraph.text,
        chunkText,
      });
    }
  }

  // Embed each pair in one call per pair (batch size = 2 — para + chunk).
  // This keeps memory and per-call complexity predictable.
  for (const pair of pairs) {
    const embedResult = await input.embedClient.embed({
      texts: [pair.paraText, pair.chunkText],
      modelId: input.embedModelId,
      inputType: "search_document",
    });

    const paraVec = embedResult.vectors[0];
    const chunkVec = embedResult.vectors[1];

    if (!paraVec || !chunkVec) continue;

    const sim = cosineSim(paraVec, chunkVec);
    const key = `${pair.paragraphIndex}:${pair.chunkId}`;

    // Keep max similarity per (paragraphIndex, chunkId) pair.
    const existing = citationSimilarities.get(key);
    if (existing === undefined || sim > existing) {
      citationSimilarities.set(key, sim);
    }
  }

  // For each paragraph that has citations, find its max citation similarity
  // and check it against the threshold.
  for (let pi = 0; pi < parsed.paragraphs.length; pi++) {
    const paragraph = parsed.paragraphs[pi];
    if (!paragraph || paragraph.sourceIds.length === 0) continue;

    let maxSim = -1;
    for (const chunkId of paragraph.sourceIds) {
      const sim = citationSimilarities.get(`${pi}:${chunkId}`);
      if (sim !== undefined && sim > maxSim) {
        maxSim = sim;
      }
    }

    if (maxSim < input.thresholds.hallucinationGuardSimilarity) {
      return {
        ok: false,
        reason: `paragraph ${pi} max citation sim ${maxSim.toFixed(4)} < ${input.thresholds.hallucinationGuardSimilarity}`,
      };
    }
  }

  // Step 7: All checks passed.
  return {
    ok: true,
    summary: parsed.summary,
    paragraphs: parsed.paragraphs,
    confidence: parsed.confidence,
    citationSimilarities,
  };
}
