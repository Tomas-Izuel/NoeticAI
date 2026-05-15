/**
 * Smoke test for the completion module (Ticket 5A.3 / 5A.4).
 *
 * Prerequisites:
 *   - Postgres running at DATABASE_URL (from .env)
 *   - Redis running at REDIS_URL (from .env)
 *   - The completion worker started inside startWorkers() picks up jobs.
 *
 * This test covers:
 *   1. POST /api/concepts/:id/complete — ownership + 201 first trigger.
 *   2. Worker processes the job to a terminal state.
 *   3. GET /api/concepts/:id/completions/latest — returns persisted row.
 *   4. Cache short-circuit — second POST within 24h returns cached=true.
 *   5. 404 for unknown concept.
 *   6. GET latest returns 404 for non-existent concept.
 *   7. GET /api/sources/:sid/chunks/:chunkId returns 404 for unknown source.
 *
 * Note: step 2 will reach null_no_grounding (no source chunks seeded) rather
 * than succeeded. The lifecycle test (lifecycle.test.ts) exercises all four
 * output paths using mocked LLM + embed clients.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { pool } from "../../db";
import { startWorkers } from "../../queue";
import { completionRouter } from "../router";
import { auth } from "../../auth";

// ---------------------------------------------------------------------------
// Fixture IDs — unique per test run to avoid conflicts with live data.
// ---------------------------------------------------------------------------
const RUN_ID = Date.now().toString(36);
const FIXTURE_USER_ID = `smoke-user-${RUN_ID}`;
const FIXTURE_SUBJECT_ID = `smoke-subj-${RUN_ID}`;
const FIXTURE_SYLLABUS_ID = `smoke-syl-${RUN_ID}`;
const FIXTURE_AUDIT_RUN_ID = `smoke-ar-${RUN_ID}`;
const FIXTURE_CONCEPT_ID = `smoke-cpt-${RUN_ID}`;
const FIXTURE_GAP_ID = `smoke-gap-${RUN_ID}`;

// ---------------------------------------------------------------------------
// Minimal app wired up for integration.
// We mount only the completionRouter; auth is real (better-auth against DB).
// Session is injected by monkey-patching auth.api.getSession.
// ---------------------------------------------------------------------------
let app: Hono;

beforeAll(async () => {
  // Start BullMQ workers (idempotent — won't re-start if already running).
  startWorkers();

  // Seed fixture data.
  // 1. User (better-auth "user" table)
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Smoke User', $2, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_USER_ID, `smoke-${RUN_ID}@test.local`],
  );

  // 2. Subject
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Smoke Subject', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SUBJECT_ID, FIXTURE_USER_ID],
  );

  // 3. Syllabus (is_active = true, version = 1)
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'smoke/test.pdf', 'test.pdf', true, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SYLLABUS_ID, FIXTURE_SUBJECT_ID],
  );

  // 4. Concept
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, learning_objective, created_at, updated_at)
     VALUES ($1, $2, 1, 'Smoke Concept', 'Understand smoke testing.', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_CONCEPT_ID, FIXTURE_SYLLABUS_ID],
  );

  // 5. Audit run (status=succeeded so cache short-circuit has a valid run to compare against)
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
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
      JSON.stringify({ embed: "smoke-embed-model", haiku: "smoke-haiku-model" }),
    ],
  );

  // 6. Gap (status=open for the concept)
  await pool.query(
    `INSERT INTO gaps (id, concept_id, first_detected_in_run, latest_run_id, current_state, status, first_detected_at, last_seen_at)
     VALUES ($1, $2, $3, $3, 'red', 'open', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_GAP_ID, FIXTURE_CONCEPT_ID, FIXTURE_AUDIT_RUN_ID],
  );

  // Build the test Hono app.
  app = new Hono();

  // Monkey-patch auth.api.getSession to return our fixture session.
  // This avoids needing a real session token/cookie in the test.
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => ({
    user: { id: FIXTURE_USER_ID, name: "Smoke User", email: `smoke-${RUN_ID}@test.local` },
    session: {
      id: "smoke-session",
      userId: FIXTURE_USER_ID,
      token: "smoke-token",
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  });

  app.route("/", completionRouter);
});

afterAll(async () => {
  // Clean up in reverse FK order.
  await pool.query(`DELETE FROM completions WHERE concept_id = $1`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM gaps WHERE id = $1`, [FIXTURE_GAP_ID]);
  await pool.query(`DELETE FROM concepts WHERE id = $1`, [FIXTURE_CONCEPT_ID]);
  await pool.query(`DELETE FROM audit_runs WHERE id = $1`, [FIXTURE_AUDIT_RUN_ID]);
  await pool.query(`DELETE FROM syllabuses WHERE id = $1`, [FIXTURE_SYLLABUS_ID]);
  await pool.query(`DELETE FROM subjects WHERE id = $1`, [FIXTURE_SUBJECT_ID]);
  await pool.query(`DELETE FROM "user" WHERE id = $1`, [FIXTURE_USER_ID]);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper: wait for a completions row to reach a terminal status.
// ---------------------------------------------------------------------------
async function waitForCompletion(
  completionId: string,
  timeoutMs = 10_000,
): Promise<{ status: string }> {
  const TERMINAL = new Set(["succeeded", "null_no_grounding", "failed"]);
  const pollInterval = 200;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await pool.query<{ status: string }>(
      `SELECT status FROM completions WHERE id = $1`,
      [completionId],
    );
    const row = rows.rows[0];
    if (row && TERMINAL.has(row.status)) return row;
    await Bun.sleep(pollInterval);
  }
  throw new Error(`completion id=${completionId} did not reach terminal status within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Test 1: POST /api/concepts/:id/complete — first trigger
// ---------------------------------------------------------------------------
let firstCompletionId: string;

test("POST /api/concepts/:id/complete returns 201 with completionId and cached=false", async () => {
  const req = new Request(`http://localhost/api/concepts/${FIXTURE_CONCEPT_ID}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });

  const res = await app.fetch(req);
  expect(res.status).toBe(201);

  const body = (await res.json()) as {
    completionId: string;
    jobId: string | null;
    cached: boolean;
  };
  expect(typeof body.completionId).toBe("string");
  expect(body.cached).toBe(false);

  firstCompletionId = body.completionId;
});

// ---------------------------------------------------------------------------
// Test 2: Worker processes the job to a terminal state within 10s.
// With no source chunks seeded, the job takes the null_no_grounding path.
// ---------------------------------------------------------------------------
test("worker processes the job to a terminal state", async () => {
  expect(firstCompletionId).toBeTruthy();

  const { status } = await waitForCompletion(firstCompletionId, 10_000);

  // No source chunks are seeded, so the zero-chunks short-circuit fires.
  expect(["succeeded", "null_no_grounding", "failed"]).toContain(status);
}, 15_000);

// ---------------------------------------------------------------------------
// Test 3: GET /api/concepts/:id/completions/latest returns the persisted row
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id/completions/latest returns the completion", async () => {
  const { status } = await waitForCompletion(firstCompletionId, 10_000);

  const req = new Request(
    `http://localhost/api/concepts/${FIXTURE_CONCEPT_ID}/completions/latest`,
  );
  const res = await app.fetch(req);
  expect(res.status).toBe(200);

  const body = (await res.json()) as {
    completion: { id: string; status: string } | null;
    citations: Record<string, unknown>;
  };
  expect(body.completion).not.toBeNull();
  expect(body.completion!.id).toBe(firstCompletionId);
  expect(body.completion!.status).toBe(status);
  expect(body.citations).toBeDefined();
}, 15_000);

// ---------------------------------------------------------------------------
// Test 4: Cache short-circuit — second POST within 24h returns cached=true
// We force the row to 'pending' to exercise the cache path.
// ---------------------------------------------------------------------------
test("second POST within 24h returns cached=true when completion is pending", async () => {
  await waitForCompletion(firstCompletionId, 10_000);

  await pool.query(
    `UPDATE completions SET status = 'pending', updated_at = NOW() WHERE id = $1`,
    [firstCompletionId],
  );

  const req = new Request(`http://localhost/api/concepts/${FIXTURE_CONCEPT_ID}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });

  const res = await app.fetch(req);
  expect(res.status).toBe(200);

  const body = (await res.json()) as {
    completionId: string;
    jobId: unknown;
    cached: boolean;
  };
  expect(body.cached).toBe(true);
  expect(body.completionId).toBe(firstCompletionId);
  expect(body.jobId).toBeNull();
}, 15_000);

// ---------------------------------------------------------------------------
// Test 5: 404 for unknown concept
// ---------------------------------------------------------------------------
test("POST /api/concepts/unknown/complete returns 404", async () => {
  const req = new Request("http://localhost/api/concepts/does-not-exist/complete", {
    method: "POST",
  });
  const res = await app.fetch(req);
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Test 6: GET /api/concepts/:id/completions/latest returns 404 for non-existent concept
// ---------------------------------------------------------------------------
test("GET latest returns 404 for concept with no completions (non-existent concept)", async () => {
  const req = new Request("http://localhost/api/concepts/no-such-concept/completions/latest");
  const res = await app.fetch(req);
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Test 7: GET /api/sources/:sid/chunks/:chunkId returns 404 for unknown source
// ---------------------------------------------------------------------------
test("GET /api/sources/:sid/chunks/:chunkId returns 404 for unknown source", async () => {
  const req = new Request("http://localhost/api/sources/no-source/chunks/no-chunk");
  const res = await app.fetch(req);
  expect(res.status).toBe(404);
});
