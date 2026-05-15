/**
 * Phase 5 eval gate — cache-hit rate ≥ 70% on sequential 80-concept sweep.
 *
 * Plan §8.3: run sequential prompt calls for up to 80 concepts within one
 * continuous time window. Bedrock caches the "system" and "subject" layers
 * across calls to the same subject — those layers should hit on calls 2..N.
 *
 * Metric:
 *   hit rate = sum(cacheReadInputTokens)
 *            / (sum(cacheReadInputTokens) + sum(freshInputTokens))
 *   where freshInputTokens = inputTokens - cacheReadInputTokens - cacheWriteInputTokens
 *
 * Gate: hit rate ≥ 0.70.
 *
 * IMPORTANT: this test is sensitive to Bedrock's ~5-minute cache TTL for
 * Anthropic models in us-east-1. The entire 80-concept sweep must complete
 * within one continuous run window. If you pause or re-run the sweep chunked
 * across TTL boundaries the subject-layer cache will have evicted and the
 * hit rate will be artificially low.
 *
 * Requirements:
 *   NOETICAI_EVAL_LIVE=1          — opt-in gate; self-skips without it.
 *   NOETICAI_AI_BACKEND=bedrock   — Bedrock required.
 *                                   On Ollama, cacheReadInputTokens is always 0
 *                                   so the hit rate gate would always fail.
 *
 * Timeout: 600 000 ms (10 min).
 */
import { test, expect } from "bun:test";
import { pool } from "../src/db";
import { embed, llm } from "../src/ai";
import { env } from "../src/env";
import { buildCompletionPrompt } from "../src/completion/prompt";

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const MAX_CONCEPTS = 80;
const HIT_RATE_GATE = 0.7;

test("cache-hit rate ≥ 70% on sequential 80-concept sweep", async () => {
  if (!LIVE) {
    console.log("[eval:cache-hit-sweep] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (env.NOETICAI_AI_BACKEND === "ollama") {
    console.log(
      "[eval:cache-hit-sweep] BEDROCK REQUIRED. " +
        "Current backend is ollama — cacheReadInputTokens is always 0 on Ollama " +
        "(cachePoints are silently no-ops for the Ollama client). " +
        "Re-run with NOETICAI_AI_BACKEND=bedrock to validate the ≥ 70% cache-hit rate gate.",
    );
    return;
  }

  // Find the subject with the most concepts (or any seeded subject).
  // We want up to 80 concepts from a single subject so the subject-layer
  // cache key is stable across the sweep.
  const subjectRows = await pool.query<{
    subject_id: string;
    subject_name: string;
    subject_course: string | null;
    concept_count: string;
  }>(
    `SELECT s.id AS subject_id, s.name AS subject_name, s.course AS subject_course,
            COUNT(c.id)::text AS concept_count
     FROM subjects s
     JOIN syllabuses sy ON sy.subject_id = s.id AND sy.is_active = TRUE
     JOIN concepts c ON c.syllabus_id = sy.id
     GROUP BY s.id, s.name, s.course
     ORDER BY COUNT(c.id) DESC
     LIMIT 1`,
  );

  const subjectRow = subjectRows.rows[0];
  if (!subjectRow) {
    console.log(
      "[eval:cache-hit-sweep] no seeded subject found with concepts + active syllabus — skipping. " +
        "Run the app, sign up, create a subject, and run a syllabus extraction first.",
    );
    return;
  }

  const { subject_id: subjectId, subject_name: subjectName, subject_course: subjectCourse } = subjectRow;
  const availableCount = parseInt(subjectRow.concept_count, 10);

  console.log(
    `[eval:cache-hit-sweep] subjectId=${subjectId} name="${subjectName}" ` +
      `availableConcepts=${availableCount} sweep=${Math.min(availableCount, MAX_CONCEPTS)}`,
  );

  // Load up to MAX_CONCEPTS concept rows for the sweep.
  const conceptRows = await pool.query<{
    id: string;
    name: string;
    learning_objective: string | null;
    neighborhood: unknown;
    updated_at: Date;
    syllabus_excerpt: string | null;
    syllabus_version: number;
  }>(
    `SELECT c.id, c.name, c.learning_objective, c.neighborhood, c.updated_at,
            c.syllabus_excerpt, sy.version AS syllabus_version
     FROM concepts c
     JOIN syllabuses sy ON sy.id = c.syllabus_id AND sy.is_active = TRUE
     WHERE sy.subject_id = $1
     ORDER BY c.name
     LIMIT $2`,
    [subjectId, MAX_CONCEPTS],
  );

  const concepts = conceptRows.rows;

  if (concepts.length === 0) {
    console.log("[eval:cache-hit-sweep] no concepts found — skipping.");
    return;
  }

  // Thresholds hash is the same across all concepts in the sweep (same subject defaults).
  const thresholdsHash = "0.85";

  // Accumulate token counts.
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalInput = 0;

  for (let i = 0; i < concepts.length; i++) {
    const concept = concepts[i]!;

    let neighborhoodNames: string[] = [];
    if (concept.neighborhood && Array.isArray(concept.neighborhood)) {
      neighborhoodNames = (concept.neighborhood as Array<{ name?: string }>)
        .map((n) => n?.name ?? "")
        .filter((s) => s.length > 0)
        .slice(0, 5);
    }

    // Build prompt with empty retrievedChunks — we are only testing the
    // cache-hit behaviour of the layered system/subject/concept tiers.
    // The user-turn (chunks) is never cached anyway.
    const promptOutput = buildCompletionPrompt({
      subjectId,
      subjectName,
      subjectCourse,
      syllabusExcerpt: concept.syllabus_excerpt ?? "",
      syllabusVersion: concept.syllabus_version,
      thresholdsHash,
      conceptId: concept.id,
      conceptUpdatedAtEpoch: concept.updated_at.getTime(),
      conceptName: concept.name,
      conceptLearningObjective: concept.learning_objective,
      neighborhoodNames,
      retrievedChunks: [],
    });

    const result = await llm.sonnet({
      system: promptOutput.system,
      layeredContext: promptOutput.layeredContext,
      cachePoints: ["system", "subject", "concept"],
      maxTokens: 256, // minimal output — we are testing cache, not generation quality
      temperature: 0,
      messages: [],
    });

    const cacheRead = result.usage.cacheReadInputTokens ?? 0;
    const cacheWrite = result.usage.cacheWriteInputTokens ?? 0;
    const input = result.usage.inputTokens;

    totalCacheRead += cacheRead;
    totalCacheWrite += cacheWrite;
    totalInput += input;

    console.log(
      `[eval:cache-hit-sweep] concept ${i + 1}/${concepts.length} ` +
        `in=${input} cacheRead=${cacheRead} cacheWrite=${cacheWrite}`,
    );
  }

  // fresh input = total input tokens that were neither a cache read hit nor a cache write
  const freshInput = totalInput - totalCacheRead - totalCacheWrite;
  // hit rate = cache reads / (cache reads + fresh input)
  // cache writes are not counted as hits (they are the warm-up writes)
  const hitRate =
    totalCacheRead + freshInput > 0
      ? totalCacheRead / (totalCacheRead + freshInput)
      : 0;

  console.log(
    `[eval:cache-hit-sweep] backend=${env.NOETICAI_AI_BACKEND} ` +
      `totalInput=${totalInput} totalCacheRead=${totalCacheRead} ` +
      `totalCacheWrite=${totalCacheWrite} freshInput=${freshInput} ` +
      `hitRate=${(hitRate * 100).toFixed(1)}%`,
  );

  expect(hitRate).toBeGreaterThanOrEqual(HIT_RATE_GATE);
}, 600_000);
