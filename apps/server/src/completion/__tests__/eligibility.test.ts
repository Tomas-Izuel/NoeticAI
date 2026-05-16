/**
 * Integration tests for GET /api/concepts/:id/completion-eligibility
 * and the POST /api/concepts/:id/complete eligibility gate.
 *
 * Covers:
 *   1. 401 / 403 / 404 — mirrors GET /api/concepts/:id auth behaviour.
 *   2. no_sources_loaded — subject has zero sources; embed is NEVER called.
 *   3. no_ready_sources — subject has sources but none are 'ready'.
 *   4. no_related_chunks — ready source exists but all chunks are below the floor.
 *   5. ok — ready source with a chunk above the floor.
 *   6. POST returns 412 with {error, reason} when eligible===false.
 *   7. Worker is NOT enqueued on a 412 (no completions row inserted).
 *   8. Cache key changes after a source is inserted (no stale hit).
 *
 * Design note: each scenario that inserts source rows uses a dedicated subject +
 * concept pair so that Redis cache keys never collide across tests (the key
 * includes conceptId, which is unique per scenario).
 *
 * Prerequisites:
 *   - Postgres + Redis running (DATABASE_URL / REDIS_URL in .env).
 *   - pgvector extension installed.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { pool } from "../../db";
import { completionRouter } from "../router";
import { auth } from "../../auth";
import { createHash } from "node:crypto";
import * as ai from "../../ai";

// ---------------------------------------------------------------------------
// Fixture IDs — unique per run
// ---------------------------------------------------------------------------
const RUN_ID = `elig-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

function mkId(suffix: string): string {
  return `${RUN_ID}-${suffix}`;
}

const USER_ID = mkId("user");
const OTHER_USER_ID = mkId("other-user");

// Primary subject — for auth tests, no_sources_loaded, no_ready_sources, POST 412, cache tests.
const SUBJECT_ID = mkId("subj");
const SYLLABUS_ID = mkId("syl");
const CONCEPT_ID = mkId("cpt");
const GAP_ID = mkId("gap");
const AUDIT_RUN_ID = mkId("ar");

// Dedicated subject for no_related_chunks scenario (cache-key isolation).
const BELOW_SUBJECT_ID = mkId("subj-below");
const BELOW_SYLLABUS_ID = mkId("syl-below");
const BELOW_CONCEPT_ID = mkId("cpt-below");

// Dedicated subject for ok (above-floor) scenario (cache-key isolation).
const ABOVE_SUBJECT_ID = mkId("subj-above");
const ABOVE_SYLLABUS_ID = mkId("syl-above");
const ABOVE_CONCEPT_ID = mkId("cpt-above");

// Other-user concept for 403 test.
const OTHER_SUBJECT_ID = mkId("other-subj");
const OTHER_SYLLABUS_ID = mkId("other-syl");
const OTHER_CONCEPT_ID = mkId("other-cpt");

// Source/chunk IDs for the sub-scenarios.
const SRC_PROCESSING = mkId("src-proc");
const SRC_BELOW = mkId("src-below");
const SRC_ABOVE = mkId("src-above");
const SRC_CACHE_TEST = mkId("src-cache");
const CHUNK_BELOW = mkId("chunk-below");
const CHUNK_ABOVE = mkId("chunk-above");

const MODEL_ID = `elig-embed-${RUN_ID}`;
const DIM = 1024;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Vector helpers — same construction as retrieve.test.ts.
const QUERY_VEC: number[] = Array(DIM).fill(0) as number[];
QUERY_VEC[0] = 1;

function makeVec(cosine: number): number[] {
  const v: number[] = Array(DIM).fill(0) as number[];
  const c = Math.min(1, Math.max(-1, cosine));
  v[0] = c;
  v[1] = Math.sqrt(Math.max(0, 1 - c * c));
  return v;
}

// ---------------------------------------------------------------------------
// Embed patching
// ---------------------------------------------------------------------------
type EmbedFn = typeof ai.embed.embed;
const originalEmbed = ai.embed.embed.bind(ai.embed);
const originalDefaultModelId = ai.embed.defaultModelId;

function patchEmbed() {
  (ai.embed as { embed: EmbedFn; defaultModelId: string }).embed = async () => ({
    modelId: MODEL_ID,
    dim: DIM,
    vectors: [QUERY_VEC],
  });
  (ai.embed as { defaultModelId: string }).defaultModelId = MODEL_ID;
}

function restoreEmbed() {
  (ai.embed as { embed: EmbedFn }).embed = originalEmbed;
  (ai.embed as { defaultModelId: string }).defaultModelId = originalDefaultModelId;
}

let embedCallCount = 0;

function patchEmbedWithCounter() {
  embedCallCount = 0;
  (ai.embed as { embed: EmbedFn; defaultModelId: string }).embed = async () => {
    embedCallCount++;
    return { modelId: MODEL_ID, dim: DIM, vectors: [QUERY_VEC] };
  };
  (ai.embed as { defaultModelId: string }).defaultModelId = MODEL_ID;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
let app: Hono;
let currentSessionUserId: string = USER_ID;

function fakeSession(userId: string) {
  return {
    user: { id: userId, name: "Elig User", email: `${RUN_ID}@test.local` },
    session: {
      id: `${RUN_ID}-sess`,
      userId,
      token: `${RUN_ID}-tok`,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  };
}

async function insertSubjectChain(
  subjectId: string,
  syllabusId: string,
  conceptId: string,
  conceptName: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [subjectId, USER_ID, `Subject for ${conceptName}`],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'elig/test.pdf', 'test.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [syllabusId, subjectId],
  );
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, learning_objective, created_at, updated_at)
     VALUES ($1, $2, 1, $3, 'Understand eligibility.', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [conceptId, syllabusId, conceptName],
  );
}

beforeAll(async () => {
  // Users.
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Elig User', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [USER_ID, `${RUN_ID}@test.local`],
  );
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Other User', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [OTHER_USER_ID, `${RUN_ID}-other@test.local`],
  );

  // Primary subject chain (auth/no-sources/412 tests).
  await insertSubjectChain(SUBJECT_ID, SYLLABUS_ID, CONCEPT_ID, "Elig Concept");

  // Audit run + gap for primary subject (POST 412 tests).
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [
      AUDIT_RUN_ID,
      SUBJECT_ID,
      SYLLABUS_ID,
      JSON.stringify({ greenDepth: 0.7, amberDepth: 0.4, minFragmentsForGreen: 2, hallucinationGuardSimilarity: 0.85 }),
      JSON.stringify({ embed: MODEL_ID }),
    ],
  );
  await pool.query(
    `INSERT INTO gaps (id, concept_id, first_detected_in_run, latest_run_id, current_state, status, first_detected_at, last_seen_at)
     VALUES ($1, $2, $3, $3, 'red', 'open', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [GAP_ID, CONCEPT_ID, AUDIT_RUN_ID],
  );

  // Other-user subject chain (403 test).
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Other Subject', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [OTHER_SUBJECT_ID, OTHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'elig/other.pdf', 'other.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [OTHER_SYLLABUS_ID, OTHER_SUBJECT_ID],
  );
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, created_at, updated_at)
     VALUES ($1, $2, 1, 'Other Concept', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [OTHER_CONCEPT_ID, OTHER_SYLLABUS_ID],
  );

  // Dedicated below-floor subject chain.
  await insertSubjectChain(BELOW_SUBJECT_ID, BELOW_SYLLABUS_ID, BELOW_CONCEPT_ID, "Below Concept");

  // Dedicated above-floor subject chain.
  await insertSubjectChain(ABOVE_SUBJECT_ID, ABOVE_SYLLABUS_ID, ABOVE_CONCEPT_ID, "Above Concept");

  app = new Hono();

  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => {
    if (!currentSessionUserId) return null;
    return fakeSession(currentSessionUserId);
  };

  app.route("/", completionRouter);
});

afterAll(async () => {
  restoreEmbed();

  // Embeddings + chunks + sources.
  await pool.query(`DELETE FROM source_chunk_embeddings WHERE chunk_id IN ($1, $2)`, [CHUNK_BELOW, CHUNK_ABOVE]);
  await pool.query(`DELETE FROM source_chunks WHERE id IN ($1, $2)`, [CHUNK_BELOW, CHUNK_ABOVE]);
  await pool.query(`DELETE FROM sources WHERE id IN ($1, $2, $3, $4)`, [SRC_PROCESSING, SRC_BELOW, SRC_ABOVE, SRC_CACHE_TEST]);

  // Completions + gaps.
  await pool.query(
    `DELETE FROM completions WHERE concept_id IN ($1, $2, $3)`,
    [CONCEPT_ID, BELOW_CONCEPT_ID, ABOVE_CONCEPT_ID],
  );
  await pool.query(`DELETE FROM gaps WHERE id = $1`, [GAP_ID]);

  // Concepts.
  await pool.query(
    `DELETE FROM concepts WHERE id IN ($1, $2, $3, $4)`,
    [CONCEPT_ID, OTHER_CONCEPT_ID, BELOW_CONCEPT_ID, ABOVE_CONCEPT_ID],
  );

  // Audit runs.
  await pool.query(`DELETE FROM audit_runs WHERE id = $1`, [AUDIT_RUN_ID]);

  // Syllabuses.
  await pool.query(
    `DELETE FROM syllabuses WHERE id IN ($1, $2, $3, $4)`,
    [SYLLABUS_ID, OTHER_SYLLABUS_ID, BELOW_SYLLABUS_ID, ABOVE_SYLLABUS_ID],
  );

  // Subjects.
  await pool.query(
    `DELETE FROM subjects WHERE id IN ($1, $2, $3, $4)`,
    [SUBJECT_ID, OTHER_SUBJECT_ID, BELOW_SUBJECT_ID, ABOVE_SUBJECT_ID],
  );

  // Users.
  await pool.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [USER_ID, OTHER_USER_ID]);

  await pool.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function eligibilityReq(conceptId: string): Request {
  return new Request(`http://localhost/api/concepts/${conceptId}/completion-eligibility`);
}

function postCompleteReq(conceptId: string): Request {
  return new Request(`http://localhost/api/concepts/${conceptId}/complete`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Auth / ownership tests
// ---------------------------------------------------------------------------

test("GET eligibility — 401 when unauthenticated", async () => {
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => null;
  try {
    const res = await app.fetch(eligibilityReq(CONCEPT_ID));
    expect(res.status).toBe(401);
  } finally {
    // biome-ignore lint: test-only cast
    (auth.api as Record<string, unknown>)["getSession"] = async () =>
      fakeSession(currentSessionUserId);
  }
});

test("GET eligibility — 404 for unknown concept", async () => {
  currentSessionUserId = USER_ID;
  const res = await app.fetch(eligibilityReq("no-such-concept"));
  expect(res.status).toBe(404);
});

test("GET eligibility — 403 when concept belongs to another user", async () => {
  currentSessionUserId = USER_ID;
  const res = await app.fetch(eligibilityReq(OTHER_CONCEPT_ID));
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Test: no_sources_loaded — embed must NOT be called
// ---------------------------------------------------------------------------

test("no_sources_loaded — embed never called, 200 with correct shape", async () => {
  currentSessionUserId = USER_ID;
  patchEmbedWithCounter();

  try {
    const res = await app.fetch(eligibilityReq(CONCEPT_ID));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      eligible: boolean;
      reason: string;
      subjectSourcesTotal: number;
      subjectSourcesReady: number;
      candidateChunkCount: number;
      topSimilarity: null;
      similarityFloor: number;
      embedModelId: string;
      checkedAt: string;
    };

    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("no_sources_loaded");
    expect(body.subjectSourcesTotal).toBe(0);
    expect(body.subjectSourcesReady).toBe(0);
    expect(body.candidateChunkCount).toBe(0);
    expect(body.topSimilarity).toBeNull();
    expect(typeof body.similarityFloor).toBe("number");
    expect(typeof body.embedModelId).toBe("string");
    expect(typeof body.checkedAt).toBe("string");

    // Critical: no embed call when no sources exist.
    expect(embedCallCount).toBe(0);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test: no_ready_sources (sources exist but none are ready)
// ---------------------------------------------------------------------------

test("no_ready_sources — returns correct shape, embed not called", async () => {
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'Processing Source', 'processing', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SRC_PROCESSING, SUBJECT_ID],
  );

  currentSessionUserId = USER_ID;
  patchEmbedWithCounter();

  try {
    const res = await app.fetch(eligibilityReq(CONCEPT_ID));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      eligible: boolean;
      reason: string;
      subjectSourcesTotal: number;
      subjectSourcesReady: number;
      candidateChunkCount: number;
    };

    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("no_ready_sources");
    expect(body.subjectSourcesTotal).toBe(1);
    expect(body.subjectSourcesReady).toBe(0);
    expect(body.candidateChunkCount).toBe(0);

    expect(embedCallCount).toBe(0);
  } finally {
    restoreEmbed();
    await pool.query(`DELETE FROM sources WHERE id = $1`, [SRC_PROCESSING]);
  }
});

// ---------------------------------------------------------------------------
// Test: no_related_chunks — ready source but all embeddings below floor.
// Uses BELOW_CONCEPT_ID/BELOW_SUBJECT_ID to guarantee cache-key isolation.
// ---------------------------------------------------------------------------

test("no_related_chunks — chunk below floor, eligible=false, topSimilarity populated", async () => {
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'Below Source', 'ready', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SRC_BELOW, BELOW_SUBJECT_ID],
  );
  await pool.query(
    `INSERT INTO source_chunks (id, source_id, position, text, text_hash, char_count, created_at)
     VALUES ($1, $2, 1, 'Low relevance chunk', $3, 20, NOW()) ON CONFLICT (id) DO NOTHING`,
    [CHUNK_BELOW, SRC_BELOW, sha256(CHUNK_BELOW)],
  );
  const belowVec = makeVec(0.20);
  await pool.query(
    `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector, created_at)
     VALUES ($1, $2, $3, $4::vector, NOW()) ON CONFLICT (chunk_id, model_id) DO NOTHING`,
    [CHUNK_BELOW, MODEL_ID, DIM, `[${belowVec.join(",")}]`],
  );

  currentSessionUserId = USER_ID;
  patchEmbed();

  try {
    const res = await app.fetch(eligibilityReq(BELOW_CONCEPT_ID));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      eligible: boolean;
      reason: string;
      subjectSourcesReady: number;
      candidateChunkCount: number;
      topSimilarity: number | null;
    };

    expect(body.eligible).toBe(false);
    expect(body.reason).toBe("no_related_chunks");
    expect(body.subjectSourcesReady).toBe(1);
    expect(body.candidateChunkCount).toBe(0);
    // topSimilarity reflects the best below-floor similarity (~0.20).
    expect(body.topSimilarity).not.toBeNull();
    expect(body.topSimilarity as number).toBeGreaterThan(0.10);
    expect(body.topSimilarity as number).toBeLessThan(0.40);
  } finally {
    restoreEmbed();
    await pool.query(`DELETE FROM source_chunk_embeddings WHERE chunk_id = $1`, [CHUNK_BELOW]);
    await pool.query(`DELETE FROM source_chunks WHERE id = $1`, [CHUNK_BELOW]);
    await pool.query(`DELETE FROM sources WHERE id = $1`, [SRC_BELOW]);
  }
});

// ---------------------------------------------------------------------------
// Test: ok — ready source with a chunk above floor.
// Uses ABOVE_CONCEPT_ID/ABOVE_SUBJECT_ID to guarantee cache-key isolation.
// ---------------------------------------------------------------------------

test("ok — chunk above floor, eligible=true, correct candidateChunkCount", async () => {
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'Above Source', 'ready', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SRC_ABOVE, ABOVE_SUBJECT_ID],
  );
  await pool.query(
    `INSERT INTO source_chunks (id, source_id, position, text, text_hash, char_count, created_at)
     VALUES ($1, $2, 1, 'Highly relevant chunk', $3, 25, NOW()) ON CONFLICT (id) DO NOTHING`,
    [CHUNK_ABOVE, SRC_ABOVE, sha256(CHUNK_ABOVE)],
  );
  const aboveVec = makeVec(0.90);
  await pool.query(
    `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector, created_at)
     VALUES ($1, $2, $3, $4::vector, NOW()) ON CONFLICT (chunk_id, model_id) DO NOTHING`,
    [CHUNK_ABOVE, MODEL_ID, DIM, `[${aboveVec.join(",")}]`],
  );

  currentSessionUserId = USER_ID;
  patchEmbed();

  try {
    const res = await app.fetch(eligibilityReq(ABOVE_CONCEPT_ID));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      eligible: boolean;
      reason: string;
      subjectSourcesReady: number;
      candidateChunkCount: number;
      topSimilarity: number | null;
    };

    expect(body.eligible).toBe(true);
    expect(body.reason).toBe("ok");
    expect(body.subjectSourcesReady).toBe(1);
    expect(body.candidateChunkCount).toBeGreaterThan(0);
    expect(body.topSimilarity).not.toBeNull();
    expect(body.topSimilarity as number).toBeGreaterThan(0.5);
  } finally {
    restoreEmbed();
    await pool.query(`DELETE FROM source_chunk_embeddings WHERE chunk_id = $1`, [CHUNK_ABOVE]);
    await pool.query(`DELETE FROM source_chunks WHERE id = $1`, [CHUNK_ABOVE]);
    await pool.query(`DELETE FROM sources WHERE id = $1`, [SRC_ABOVE]);
  }
});

// ---------------------------------------------------------------------------
// Test: POST /complete returns 412 when no sources loaded
// ---------------------------------------------------------------------------

test("POST /complete returns 412 with {error, reason} when no sources", async () => {
  currentSessionUserId = USER_ID;
  patchEmbed();

  try {
    const res = await app.fetch(postCompleteReq(CONCEPT_ID));
    expect(res.status).toBe(412);

    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe("ineligible");
    expect(["no_sources_loaded", "no_ready_sources", "no_related_chunks"]).toContain(body.reason);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test: no completions row inserted on 412
// ---------------------------------------------------------------------------

test("no completions row inserted when POST returns 412", async () => {
  currentSessionUserId = USER_ID;
  patchEmbed();

  const before = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM completions WHERE concept_id = $1`,
    [CONCEPT_ID],
  );
  const beforeCount = parseInt(before.rows[0]?.cnt ?? "0", 10);

  try {
    const res = await app.fetch(postCompleteReq(CONCEPT_ID));
    expect(res.status).toBe(412);

    const after = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM completions WHERE concept_id = $1`,
      [CONCEPT_ID],
    );
    const afterCount = parseInt(after.rows[0]?.cnt ?? "0", 10);

    expect(afterCount).toBe(beforeCount);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test: cache key changes after source insert (natural cache-busting)
// ---------------------------------------------------------------------------

test("cache key shifts after inserting a source — second call reflects new state", async () => {
  currentSessionUserId = USER_ID;
  patchEmbed();

  try {
    // First call — CONCEPT_ID has zero sources at this point.
    const res1 = await app.fetch(eligibilityReq(CONCEPT_ID));
    const body1 = (await res1.json()) as { subjectSourcesTotal: number };
    expect(body1.subjectSourcesTotal).toBe(0);

    // Insert a source — total changes from 0 to 1, shifting the cache key.
    await pool.query(
      `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
       VALUES ($1, $2, 'pdf', 'Cache Test Source', 'processing', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      [SRC_CACHE_TEST, SUBJECT_ID],
    );

    // Second call — cache key is different (total=1 vs total=0), so loader re-runs.
    const res2 = await app.fetch(eligibilityReq(CONCEPT_ID));
    const body2 = (await res2.json()) as { subjectSourcesTotal: number };
    expect(body2.subjectSourcesTotal).toBe(1);
  } finally {
    restoreEmbed();
    await pool.query(`DELETE FROM sources WHERE id = $1`, [SRC_CACHE_TEST]);
  }
});
