/**
 * Integration tests for retrieveChunksForConcept (retrieve.ts).
 *
 * Prerequisites:
 *   - Postgres running at DATABASE_URL (from .env) with pgvector extension.
 *   - The retrieve module uses the real embed client, so we patch it to avoid
 *     live embed calls. We inject a fixed query vector via module override.
 *
 * Fixture:
 *   - 1 subject, 1 concept, 2 sources (1 ready, 1 failed), 5 chunks across
 *     the sources, embeddings at controlled cosine distances.
 *
 * Tests:
 *   1. Only chunks from ready sources are returned.
 *   2. Chunks below the 0.55 similarity floor are filtered out.
 *   3. At most 3 chunks per source (diversity cap).
 *   4. Results are ordered by descending similarity.
 *   5. Zero results when no sources are ready.
 *
 * Run with: bun test src/completion/__tests__/retrieve.test.ts
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { pool } from "../../db";
import { retrieveChunksForConcept } from "../retrieve";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Fixture IDs
// ---------------------------------------------------------------------------
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const FIXTURE_USER_ID = `ret-user-${RUN_ID}`;
const FIXTURE_SUBJECT_ID = `ret-subj-${RUN_ID}`;
const FIXTURE_SYLLABUS_ID = `ret-syl-${RUN_ID}`;
const FIXTURE_CONCEPT_ID = `ret-cpt-${RUN_ID}`;
const FIXTURE_SOURCE_READY_ID = `ret-src-ready-${RUN_ID}`;
const FIXTURE_SOURCE_FAILED_ID = `ret-src-failed-${RUN_ID}`;

// Chunk IDs — 4 from ready source, 2 from failed source
const CHUNK_R1 = `ret-chunk-r1-${RUN_ID}`;
const CHUNK_R2 = `ret-chunk-r2-${RUN_ID}`;
const CHUNK_R3 = `ret-chunk-r3-${RUN_ID}`;
const CHUNK_R4 = `ret-chunk-r4-${RUN_ID}`;
const CHUNK_F1 = `ret-chunk-f1-${RUN_ID}`;
const CHUNK_F2 = `ret-chunk-f2-${RUN_ID}`;

// Model ID used for all embeddings in this fixture.
const MODEL_ID = "test-embed-retrieve";

// Dimension (must match pgvector column dim; source_chunk_embeddings uses 1024).
const DIM = 1024;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Build a pgvector literal from a cosine-distance value.
 *
 * We use a deterministic construction:
 *   queryVec = [1, 0, 0, ...]  (stored in the concept embed mock below)
 *   chunkVec = [cosine, sqrt(1 - cosine^2), 0, ...]
 *
 * This gives cosine similarity = cosineValue between queryVec and chunkVec.
 *
 * The cosine distance (pgvector's `<=>`) = 1 - cosine similarity.
 * The similarity filter in retrieve.ts is: (1 - (e.vector <=> $1::vector)) >= 0.55
 * i.e., cosine similarity >= 0.55.
 */
function makeChunkVector(cosineValue: number): number[] {
  const v = Array(DIM).fill(0) as number[];
  const clipped = Math.min(1, Math.max(-1, cosineValue));
  v[0] = clipped;
  v[1] = Math.sqrt(Math.max(0, 1 - clipped * clipped));
  return v;
}

/**
 * The "query vector" that retrieve.ts embeds for the concept.
 * We patch embed.embed to return this fixed vector so the cosine distances
 * in the DB match our makeChunkVector() construction.
 */
const QUERY_VECTOR = Array(DIM).fill(0) as number[];
QUERY_VECTOR[0] = 1;

// ---------------------------------------------------------------------------
// Seed fixture
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // User
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Retrieve User', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_USER_ID, `retrieve-${RUN_ID}@test.local`],
  );

  // Subject
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Retrieve Subject', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SUBJECT_ID, FIXTURE_USER_ID],
  );

  // Syllabus
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'ret/test.pdf', 'test.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SYLLABUS_ID, FIXTURE_SUBJECT_ID],
  );

  // Concept
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, learning_objective, created_at, updated_at)
     VALUES ($1, $2, 1, 'Retrieve Concept', 'Understand retrieval.', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_CONCEPT_ID, FIXTURE_SYLLABUS_ID],
  );

  // Source: ready
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'Ready Source', 'ready', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SOURCE_READY_ID, FIXTURE_SUBJECT_ID],
  );

  // Source: failed (should be excluded from results)
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, created_at, updated_at)
     VALUES ($1, $2, 'pdf', 'Failed Source', 'failed', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SOURCE_FAILED_ID, FIXTURE_SUBJECT_ID],
  );

  // Chunks from the ready source.
  // Cosines: R1=0.95, R2=0.90, R3=0.80, R4=0.60, all >= 0.55 floor → all should appear
  // (before diversity cap; 4 from one source, cap is 3, so R4 will be cut)
  const readyChunks = [
    { id: CHUNK_R1, pos: 1, cosine: 0.95 },
    { id: CHUNK_R2, pos: 2, cosine: 0.90 },
    { id: CHUNK_R3, pos: 3, cosine: 0.80 },
    { id: CHUNK_R4, pos: 4, cosine: 0.60 },
  ];

  for (const c of readyChunks) {
    await pool.query(
      `INSERT INTO source_chunks (id, source_id, position, text, text_hash, char_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (id) DO NOTHING`,
      [c.id, FIXTURE_SOURCE_READY_ID, c.pos, `Chunk text for ${c.id}`, sha256(c.id), 30],
    );
    const vec = makeChunkVector(c.cosine);
    const literal = `[${vec.join(",")}]`;
    await pool.query(
      `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector, created_at)
       VALUES ($1, $2, $3, $4::vector, NOW())
       ON CONFLICT (chunk_id, model_id) DO NOTHING`,
      [c.id, MODEL_ID, DIM, literal],
    );
  }

  // Chunks from the failed source — should never appear in results.
  const failedChunks = [
    { id: CHUNK_F1, pos: 1, cosine: 0.98 },
    { id: CHUNK_F2, pos: 2, cosine: 0.97 },
  ];

  for (const c of failedChunks) {
    await pool.query(
      `INSERT INTO source_chunks (id, source_id, position, text, text_hash, char_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (id) DO NOTHING`,
      [c.id, FIXTURE_SOURCE_FAILED_ID, c.pos, `Chunk text for ${c.id}`, sha256(c.id), 30],
    );
    const vec = makeChunkVector(c.cosine);
    const literal = `[${vec.join(",")}]`;
    await pool.query(
      `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector, created_at)
       VALUES ($1, $2, $3, $4::vector, NOW())
       ON CONFLICT (chunk_id, model_id) DO NOTHING`,
      [c.id, MODEL_ID, DIM, literal],
    );
  }
});

afterAll(async () => {
  // Delete in reverse FK order.
  for (const chunkId of [CHUNK_R1, CHUNK_R2, CHUNK_R3, CHUNK_R4, CHUNK_F1, CHUNK_F2]) {
    await pool.query(`DELETE FROM source_chunk_embeddings WHERE chunk_id = $1`, [chunkId]);
    await pool.query(`DELETE FROM source_chunks WHERE id = $1`, [chunkId]);
  }
  await pool.query(`DELETE FROM sources WHERE id = $1`, [FIXTURE_SOURCE_READY_ID]);
  await pool.query(`DELETE FROM sources WHERE id = $1`, [FIXTURE_SOURCE_FAILED_ID]);
  await pool.query(`DELETE FROM concepts WHERE id = $1`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM syllabuses WHERE id = $1`, [FIXTURE_SYLLABUS_ID]);
  await pool.query(`DELETE FROM subjects WHERE id = $1`, [FIXTURE_SUBJECT_ID]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [FIXTURE_USER_ID]);
});

// ---------------------------------------------------------------------------
// We need to patch the embed module to return our fixed QUERY_VECTOR so that
// the cosine similarity in the DB matches our fixture construction.
//
// Bun test doesn't have vi.mock. We patch the module cache via a workaround:
// we directly import the ai module and replace the embed.embed method for
// the duration of these tests.
// ---------------------------------------------------------------------------

// We import the ai module after seeding, then patch embed.embed.
// This is done inline in each test using a wrapper that restores after.

import * as ai from "../../ai";

const originalEmbed = ai.embed.embed.bind(ai.embed);

function patchEmbed() {
  (ai.embed as { embed: typeof ai.embed.embed }).embed = async () => ({
    modelId: MODEL_ID,
    dim: DIM,
    vectors: [QUERY_VECTOR],
  });
}

function restoreEmbed() {
  (ai.embed as { embed: typeof ai.embed.embed }).embed = originalEmbed;
}

// ---------------------------------------------------------------------------
// Test 1: Only chunks from ready sources are returned
// ---------------------------------------------------------------------------

test("returns chunks only from ready sources (not failed)", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
    });

    const returnedIds = new Set(chunks.map((c) => c.chunkId));
    expect(returnedIds.has(CHUNK_F1)).toBe(false);
    expect(returnedIds.has(CHUNK_F2)).toBe(false);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 2: Similarity floor (>= 0.55) — all ready chunks are above floor
// ---------------------------------------------------------------------------

test("all chunks from the ready source are above the 0.55 similarity floor", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
    });

    for (const chunk of chunks) {
      expect(chunk.retrievalSimilarity).toBeGreaterThanOrEqual(0.55);
    }
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 3: Diversity cap — at most 3 chunks per source
// ---------------------------------------------------------------------------

test("at most 3 chunks per source (diversity cap)", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
      k: 10,
    });

    const countBySource = new Map<string, number>();
    for (const chunk of chunks) {
      const current = countBySource.get(chunk.sourceId) ?? 0;
      countBySource.set(chunk.sourceId, current + 1);
    }

    for (const [, count] of countBySource) {
      expect(count).toBeLessThanOrEqual(3);
    }
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 4: Results ordered by descending similarity
// ---------------------------------------------------------------------------

test("results are ordered by descending similarity", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
    });

    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      if (prev && curr) {
        expect(prev.retrievalSimilarity).toBeGreaterThanOrEqual(curr.retrievalSimilarity);
      }
    }
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 5: Top 3 chunks from ready source are R1, R2, R3 (R4 is 4th — cut by cap)
// ---------------------------------------------------------------------------

test("exactly 3 chunks from the ready source (R4 cut by diversity cap)", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
      k: 10,
    });

    const returnedIds = new Set(chunks.map((c) => c.chunkId));
    // The top 3 by similarity should be R1 (0.95), R2 (0.90), R3 (0.80).
    expect(returnedIds.has(CHUNK_R1)).toBe(true);
    expect(returnedIds.has(CHUNK_R2)).toBe(true);
    expect(returnedIds.has(CHUNK_R3)).toBe(true);
    // R4 (0.60) is 4th from the same source — cut by MAX_CHUNKS_PER_SOURCE=3.
    expect(returnedIds.has(CHUNK_R4)).toBe(false);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 6: Returns [] when there are no ready sources for the subject
// ---------------------------------------------------------------------------

test("returns empty array when conceptId does not exist", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: "nonexistent-concept-id",
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
    });
    expect(chunks).toHaveLength(0);
  } finally {
    restoreEmbed();
  }
});

// ---------------------------------------------------------------------------
// Test 7: Chunk fields are populated correctly
// ---------------------------------------------------------------------------

test("returned chunks have expected fields populated", async () => {
  patchEmbed();
  try {
    const { chunks } = await retrieveChunksForConcept({
      conceptId: FIXTURE_CONCEPT_ID,
      subjectId: FIXTURE_SUBJECT_ID,
      modelId: MODEL_ID,
    });

    expect(chunks.length).toBeGreaterThan(0);
    const first = chunks[0];
    expect(first).toBeDefined();
    if (first) {
      expect(typeof first.chunkId).toBe("string");
      expect(typeof first.sourceId).toBe("string");
      expect(typeof first.sourceTitle).toBe("string");
      expect(typeof first.text).toBe("string");
      expect(typeof first.retrievalSimilarity).toBe("number");
      expect(first.sourceTitle).toBe("Ready Source");
    }
  } finally {
    restoreEmbed();
  }
});
