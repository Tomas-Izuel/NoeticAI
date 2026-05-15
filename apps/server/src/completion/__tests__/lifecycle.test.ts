/**
 * Lifecycle integration tests for runCompletionJob (job.ts).
 *
 * Exercises the four completion output paths:
 *   1. succeeded       — guard passes, citations persisted.
 *   2. null_no_grounding (guard fail) — confidence < 0.85.
 *   3. null_no_grounding (zero chunks) — no source chunks, LLM never called.
 *   4. failed          — LLM throws, failure_reason persisted.
 *
 * The LLM (llm.sonnet) and embed client (embed.embed) are patched at the
 * object level — no top-level module mock needed. Since job.ts imports llm
 * and embed by reference from "../ai", replacing the method on the live
 * exported object is visible to job.ts at call time.
 *
 * Prerequisites:
 *   - Postgres running at DATABASE_URL (from .env).
 *   - pgvector extension installed.
 *   - All Phase 5 migrations applied (completions, citations tables exist).
 *
 * Run with: bun test src/completion/__tests__/lifecycle.test.ts
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { pool } from "../../db";
import { embed, llm } from "../../ai";
import { runCompletionJob } from "../job";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Fixture IDs
// ---------------------------------------------------------------------------
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function id(prefix: string): string {
  return `${prefix}-${RUN_ID}`;
}

const FIXTURE_USER_ID = id("lc-user");
const FIXTURE_SUBJECT_ID = id("lc-subj");
const FIXTURE_SYLLABUS_ID = id("lc-syl");
const FIXTURE_AUDIT_RUN_ID = id("lc-ar");
const FIXTURE_CONCEPT_ID = id("lc-cpt");
const FIXTURE_GAP_ID = id("lc-gap");
const FIXTURE_SOURCE_ID = id("lc-src");
const FIXTURE_CHUNK_ID = id("lc-chunk");

const MODEL_ID = "lc-embed-model";
const DIM = 1024;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Patch helpers for llm.sonnet, embed.embed, and embed.defaultModelId
// ---------------------------------------------------------------------------

type SonnetFn = typeof llm.sonnet;
type EmbedFn = typeof embed.embed;

let originalSonnet: SonnetFn;
let originalEmbed: EmbedFn;
let originalDefaultModelId: string;

function patchLlm(fn: SonnetFn) {
  (llm as { sonnet: SonnetFn }).sonnet = fn;
}

function patchEmbed(fn: EmbedFn) {
  // Also override defaultModelId so retrieveChunksForConcept uses MODEL_ID
  // which matches the test fixture embeddings in source_chunk_embeddings.
  (embed as { embed: EmbedFn; defaultModelId: string }).embed = fn;
  (embed as { defaultModelId: string }).defaultModelId = MODEL_ID;
}

function restoreLlm() {
  (llm as { sonnet: SonnetFn }).sonnet = originalSonnet;
}

function restoreEmbed() {
  (embed as { embed: EmbedFn }).embed = originalEmbed;
  (embed as { defaultModelId: string }).defaultModelId = originalDefaultModelId;
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const UNIT_VEC: number[] = Array(DIM).fill(0) as number[];
UNIT_VEC[0] = 1;

function makeSimilarVec(cosine: number): number[] {
  const v: number[] = Array(DIM).fill(0) as number[];
  const c = Math.min(1, Math.max(-1, cosine));
  v[0] = c;
  v[1] = Math.sqrt(Math.max(0, 1 - c * c));
  return v;
}

// A vector that gives cosine 0.92 with UNIT_VEC.
const HIGH_SIM_VEC = makeSimilarVec(0.92);

// ---------------------------------------------------------------------------
// completionId allocation helper
// ---------------------------------------------------------------------------
let completionIdCounter = 0;
function allocateCompletionId(): string {
  completionIdCounter++;
  return sha256(`lc-completion-${RUN_ID}-${completionIdCounter}`).slice(0, 24);
}

async function insertCompletionRow(
  completionId: string,
  conceptId: string,
  gapId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO completions
       (id, gap_id, concept_id, audit_run_id, status, model_id, embed_model_id,
        prompt_hash, input_tokens, output_tokens, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'queued', 'placeholder', 'placeholder', '', 0, 0, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [completionId, gapId, conceptId, FIXTURE_AUDIT_RUN_ID],
  );
}

// ---------------------------------------------------------------------------
// Seed fixture
// ---------------------------------------------------------------------------
beforeAll(async () => {
  originalSonnet = llm.sonnet.bind(llm);
  originalEmbed = embed.embed.bind(embed);
  originalDefaultModelId = embed.defaultModelId;

  // User
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'LC User', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_USER_ID, `lc-${RUN_ID}@test.local`],
  );

  // Subject
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'LC Subject', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SUBJECT_ID, FIXTURE_USER_ID],
  );

  // Syllabus
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'lc/test.pdf', 'test.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SYLLABUS_ID, FIXTURE_SUBJECT_ID],
  );

  // Concept
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, learning_objective, created_at, updated_at)
     VALUES ($1, $2, 1, 'LC Concept', 'Understand lifecycle testing.', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_CONCEPT_ID, FIXTURE_SYLLABUS_ID],
  );

  // Audit run with thresholds
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [
      FIXTURE_AUDIT_RUN_ID,
      FIXTURE_SUBJECT_ID,
      FIXTURE_SYLLABUS_ID,
      JSON.stringify({
        greenDepth: 0.7,
        amberDepth: 0.4,
        minFragmentsForGreen: 2,
        conflictMinFragments: 3,
        hallucinationGuardSimilarity: 0.85,
      }),
      JSON.stringify({ embed: MODEL_ID }),
    ],
  );

  // Gap
  await pool.query(
    `INSERT INTO gaps (id, concept_id, first_detected_in_run, latest_run_id, current_state, status, first_detected_at, last_seen_at)
     VALUES ($1, $2, $3, $3, 'red', 'open', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_GAP_ID, FIXTURE_CONCEPT_ID, FIXTURE_AUDIT_RUN_ID],
  );

  // Source + chunk + embedding (used by scenarios that need real chunks)
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'LC Source', 'ready', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SOURCE_ID, FIXTURE_SUBJECT_ID],
  );

  await pool.query(
    `INSERT INTO source_chunks (id, source_id, position, text, text_hash, char_count, created_at)
     VALUES ($1, $2, 1, 'Relevant chunk text for the concept.', $3, 40, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_CHUNK_ID, FIXTURE_SOURCE_ID, sha256(FIXTURE_CHUNK_ID)],
  );

  // Embedding with HIGH_SIM_VEC (cosine 0.92 with UNIT_VEC query)
  const literal = `[${HIGH_SIM_VEC.join(",")}]`;
  await pool.query(
    `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector, created_at)
     VALUES ($1, $2, $3, $4::vector, NOW())
     ON CONFLICT (chunk_id, model_id) DO NOTHING`,
    [FIXTURE_CHUNK_ID, MODEL_ID, DIM, literal],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM citations WHERE completion_id IN (SELECT id FROM completions WHERE concept_id = $1)`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM completions WHERE concept_id = $1`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM source_chunk_embeddings WHERE chunk_id = $1`, [FIXTURE_CHUNK_ID]);
  await pool.query(`DELETE FROM source_chunks WHERE id = $1`, [FIXTURE_CHUNK_ID]);
  await pool.query(`DELETE FROM sources WHERE id = $1`, [FIXTURE_SOURCE_ID]);
  await pool.query(`DELETE FROM gaps WHERE id = $1`, [FIXTURE_GAP_ID]);
  await pool.query(`DELETE FROM concepts WHERE id = $1`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM audit_runs WHERE id = $1`, [FIXTURE_AUDIT_RUN_ID]);
  await pool.query(`DELETE FROM syllabuses WHERE id = $1`, [FIXTURE_SYLLABUS_ID]);
  await pool.query(`DELETE FROM subjects WHERE id = $1`, [FIXTURE_SUBJECT_ID]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [FIXTURE_USER_ID]);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper: mock embed to return the unit query vector (for retrieve) and
// two specific vectors for guard re-similarity checks.
// ---------------------------------------------------------------------------

function makeEmbedMock(guardCosine: number): EmbedFn {
  return async (args) => {
    if (args.texts.length === 1) {
      // This is the retrieve query embed call.
      return { modelId: MODEL_ID, dim: DIM, vectors: [UNIT_VEC] };
    }
    // This is the guard re-similarity call (2 texts: para + chunk).
    const c = guardCosine;
    const clipped = Math.min(1, Math.max(-1, c));
    const vecA: number[] = Array(DIM).fill(0) as number[];
    vecA[0] = 1;
    const vecB: number[] = Array(DIM).fill(0) as number[];
    vecB[0] = clipped;
    vecB[1] = Math.sqrt(Math.max(0, 1 - clipped * clipped));
    return { modelId: MODEL_ID, dim: DIM, vectors: [vecA, vecB] };
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: succeeded
// ---------------------------------------------------------------------------

test("scenario: succeeded — guard passes, citations persisted", async () => {
  const completionId = allocateCompletionId();
  await insertCompletionRow(completionId, FIXTURE_CONCEPT_ID, FIXTURE_GAP_ID);

  // LLM returns valid, grounded output citing the fixture chunk.
  let llmCallCount = 0;
  patchLlm(async () => {
    llmCallCount++;
    return {
      text: JSON.stringify({
        summary: "A grounded summary of the concept.",
        paragraphs: [
          { text: "This concept is explained in depth by the cited source.", sourceIds: [FIXTURE_CHUNK_ID] },
        ],
        confidence: 0.93,
      }),
      modelId: "test-sonnet",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    };
  });

  // Embed: query returns UNIT_VEC, guard re-similarity returns cosine 0.92 (> 0.85).
  patchEmbed(makeEmbedMock(0.92));

  try {
    const result = await runCompletionJob({
      completionId,
      conceptId: FIXTURE_CONCEPT_ID,
      gapId: FIXTURE_GAP_ID,
      auditRunId: FIXTURE_AUDIT_RUN_ID,
      subjectId: FIXTURE_SUBJECT_ID,
    });

    expect(result.status).toBe("succeeded");
    expect(result.completionId).toBe(completionId);
    expect(llmCallCount).toBe(1);

    // Verify DB row.
    const row = await pool.query<{
      status: string;
      summary: string;
      confidence: string;
      model_id: string;
      input_tokens: number;
      output_tokens: number;
    }>(
      `SELECT status, summary, confidence, model_id, input_tokens, output_tokens
       FROM completions WHERE id = $1`,
      [completionId],
    );
    expect(row.rows[0]?.status).toBe("pending");
    expect(row.rows[0]?.summary).toBe("A grounded summary of the concept.");
    expect(parseFloat(row.rows[0]?.confidence ?? "0")).toBeCloseTo(0.93, 2);
    expect(row.rows[0]?.model_id).toBe("test-sonnet");
    expect(row.rows[0]?.input_tokens).toBe(100);
    expect(row.rows[0]?.output_tokens).toBe(50);

    // Verify citations row.
    const citations = await pool.query<{
      chunk_id: string;
      paragraph_index: number;
      similarity: string;
    }>(
      `SELECT chunk_id, paragraph_index, similarity FROM citations WHERE completion_id = $1`,
      [completionId],
    );
    expect(citations.rows.length).toBe(1);
    expect(citations.rows[0]?.chunk_id).toBe(FIXTURE_CHUNK_ID);
    expect(citations.rows[0]?.paragraph_index).toBe(0);
    expect(parseFloat(citations.rows[0]?.similarity ?? "0")).toBeGreaterThan(0.8);
  } finally {
    restoreLlm();
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: null_no_grounding (guard fail — confidence below threshold)
// ---------------------------------------------------------------------------

test("scenario: null_no_grounding (guard fail) — confidence below 0.85", async () => {
  const completionId = allocateCompletionId();
  await insertCompletionRow(completionId, FIXTURE_CONCEPT_ID, FIXTURE_GAP_ID);

  let llmCallCount = 0;
  patchLlm(async () => {
    llmCallCount++;
    return {
      text: JSON.stringify({
        summary: "Low confidence summary.",
        paragraphs: [
          { text: "Para with citation.", sourceIds: [FIXTURE_CHUNK_ID] },
        ],
        confidence: 0.50,
      }),
      modelId: "test-sonnet",
      usage: { inputTokens: 80, outputTokens: 40, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
    };
  });

  patchEmbed(makeEmbedMock(0.92));

  try {
    const result = await runCompletionJob({
      completionId,
      conceptId: FIXTURE_CONCEPT_ID,
      gapId: FIXTURE_GAP_ID,
      auditRunId: FIXTURE_AUDIT_RUN_ID,
      subjectId: FIXTURE_SUBJECT_ID,
    });

    expect(result.status).toBe("null_no_grounding");
    expect(result.guardFailureReason).toBeDefined();
    expect(result.guardFailureReason).toContain("confidence");
    expect(llmCallCount).toBe(1);

    // Verify DB row.
    const row = await pool.query<{
      status: string;
      guard_failure_reason: string;
    }>(
      `SELECT status, guard_failure_reason FROM completions WHERE id = $1`,
      [completionId],
    );
    expect(row.rows[0]?.status).toBe("null_no_grounding");
    expect(row.rows[0]?.guard_failure_reason).toContain("confidence");

    // No citations should be persisted.
    const citations = await pool.query(
      `SELECT COUNT(*) AS cnt FROM citations WHERE completion_id = $1`,
      [completionId],
    );
    expect(parseInt(citations.rows[0]?.cnt ?? "0", 10)).toBe(0);
  } finally {
    restoreLlm();
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Scenario 3: null_no_grounding (zero chunks) — LLM must NOT be called
// ---------------------------------------------------------------------------

test("scenario: null_no_grounding (zero chunks) — llm.sonnet never called", async () => {
  // Use a separate subject with no ready sources. The zero-chunks path fires
  // when retrieveChunksForConcept returns [] — which happens when there are
  // no ready sources for the subject (not per-concept filtering).
  const emptySubjectId = id("lc-emptysubj");
  const emptySyllabusId = id("lc-emptysyl");
  const emptyConceptId = id("lc-emptycpt");
  const emptyGapId = id("lc-emptygap");
  const emptyAuditRunId = id("lc-emptyar");
  const nochunkCompletionId = allocateCompletionId();

  // User already seeded. Create empty subject chain.
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Empty Subject', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [emptySubjectId, FIXTURE_USER_ID],
  );

  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'lc/empty.pdf', 'empty.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [emptySyllabusId, emptySubjectId],
  );

  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, learning_objective, created_at, updated_at)
     VALUES ($1, $2, 1, 'Empty Concept', 'No sources exist.', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [emptyConceptId, emptySyllabusId],
  );

  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [
      emptyAuditRunId,
      emptySubjectId,
      emptySyllabusId,
      JSON.stringify({ greenDepth: 0.7, amberDepth: 0.4, minFragmentsForGreen: 2, hallucinationGuardSimilarity: 0.85 }),
      JSON.stringify({ embed: MODEL_ID }),
    ],
  );

  await pool.query(
    `INSERT INTO gaps (id, concept_id, first_detected_in_run, latest_run_id, current_state, status, first_detected_at, last_seen_at)
     VALUES ($1, $2, $3, $3, 'red', 'open', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [emptyGapId, emptyConceptId, emptyAuditRunId],
  );

  await pool.query(
    `INSERT INTO completions
       (id, gap_id, concept_id, audit_run_id, status, model_id, embed_model_id,
        prompt_hash, input_tokens, output_tokens, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'queued', 'placeholder', 'placeholder', '', 0, 0, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [nochunkCompletionId, emptyGapId, emptyConceptId, emptyAuditRunId],
  );

  let llmCallCount = 0;
  patchLlm(async () => {
    llmCallCount++;
    return {
      text: "{}",
      modelId: "test-sonnet",
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  });

  // Embed returns unit vec for the query embed; no guard embed should happen.
  patchEmbed(async (args) => ({
    modelId: MODEL_ID,
    dim: DIM,
    vectors: args.texts.map(() => UNIT_VEC),
  }));

  try {
    const result = await runCompletionJob({
      completionId: nochunkCompletionId,
      conceptId: emptyConceptId,
      gapId: emptyGapId,
      auditRunId: emptyAuditRunId,
      subjectId: emptySubjectId,
    });

    expect(result.status).toBe("null_no_grounding");
    // LLM must NOT have been called.
    expect(llmCallCount).toBe(0);

    // Verify guard_failure_reason describes the zero-chunks path.
    const row = await pool.query<{
      status: string;
      guard_failure_reason: string;
    }>(
      `SELECT status, guard_failure_reason FROM completions WHERE id = $1`,
      [nochunkCompletionId],
    );
    expect(row.rows[0]?.status).toBe("null_no_grounding");
    expect(row.rows[0]?.guard_failure_reason).toContain("no source chunks");
  } finally {
    restoreLlm();
    restoreEmbed();
    // Clean up extra fixtures in reverse FK order.
    await pool.query(`DELETE FROM completions WHERE id = $1`, [nochunkCompletionId]);
    await pool.query(`DELETE FROM gaps WHERE id = $1`, [emptyGapId]);
    await pool.query(`DELETE FROM concepts WHERE id = $1`, [emptyConceptId]);
    await pool.query(`DELETE FROM audit_runs WHERE id = $1`, [emptyAuditRunId]);
    await pool.query(`DELETE FROM syllabuses WHERE id = $1`, [emptySyllabusId]);
    await pool.query(`DELETE FROM subjects WHERE id = $1`, [emptySubjectId]);
  }
});

// ---------------------------------------------------------------------------
// Scenario 4: failed — LLM throws, failure_reason persisted
// ---------------------------------------------------------------------------

test("scenario: failed — llm.sonnet throws, failure_reason persisted", async () => {
  const completionId = allocateCompletionId();
  await insertCompletionRow(completionId, FIXTURE_CONCEPT_ID, FIXTURE_GAP_ID);

  patchLlm(async () => {
    throw new Error("Simulated LLM network failure");
  });

  patchEmbed(async (args) => ({
    modelId: MODEL_ID,
    dim: DIM,
    vectors: args.texts.map(() => UNIT_VEC),
  }));

  try {
    // processCompletionJob wraps runCompletionJob and persists status=failed.
    // runCompletionJob itself re-throws — we call processCompletionJob.
    const { processCompletionJob } = await import("../job");

    let thrown = false;
    try {
      await processCompletionJob({
        completionId,
        conceptId: FIXTURE_CONCEPT_ID,
        gapId: FIXTURE_GAP_ID,
        auditRunId: FIXTURE_AUDIT_RUN_ID,
        subjectId: FIXTURE_SUBJECT_ID,
      });
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(true);

    // Verify DB row has status='failed' + failure_reason.
    const row = await pool.query<{
      status: string;
      failure_reason: string;
    }>(
      `SELECT status, failure_reason FROM completions WHERE id = $1`,
      [completionId],
    );
    expect(row.rows[0]?.status).toBe("failed");
    expect(row.rows[0]?.failure_reason).toContain("Simulated LLM network failure");
  } finally {
    restoreLlm();
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Scenario 5: null_no_grounding (model returns null summary)
// ---------------------------------------------------------------------------

test("scenario: null_no_grounding — model returns summary:null", async () => {
  const completionId = allocateCompletionId();
  await insertCompletionRow(completionId, FIXTURE_CONCEPT_ID, FIXTURE_GAP_ID);

  patchLlm(async () => ({
    text: JSON.stringify({ summary: null, paragraphs: [], confidence: 0.0 }),
    modelId: "test-sonnet",
    usage: { inputTokens: 60, outputTokens: 20, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
  }));

  patchEmbed(makeEmbedMock(0.92));

  try {
    const result = await runCompletionJob({
      completionId,
      conceptId: FIXTURE_CONCEPT_ID,
      gapId: FIXTURE_GAP_ID,
      auditRunId: FIXTURE_AUDIT_RUN_ID,
      subjectId: FIXTURE_SUBJECT_ID,
    });

    expect(result.status).toBe("null_no_grounding");
    expect(result.guardFailureReason).toBe("model returned null");

    const row = await pool.query<{ status: string; guard_failure_reason: string }>(
      `SELECT status, guard_failure_reason FROM completions WHERE id = $1`,
      [completionId],
    );
    expect(row.rows[0]?.status).toBe("null_no_grounding");
    expect(row.rows[0]?.guard_failure_reason).toBe("model returned null");
  } finally {
    restoreLlm();
    restoreEmbed();
  }
});
