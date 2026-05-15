/**
 * Integration tests for GET /api/concepts/:id (Ticket 5A.5).
 *
 * Prerequisites:
 *   - Postgres running at DATABASE_URL (from .env)
 *
 * Covers:
 *   1. 401 without session.
 *   2. 403 when concept belongs to a different user.
 *   3. 404 when concept does not exist.
 *   4. 200 with full ConceptDetail shape (unit + subject + neighborhood).
 *   5. 200 with latestRun: null when no succeeded audit run exists.
 *   6. 200 with latestRun: { id } when a succeeded audit run exists.
 *   7. Returns the most-recent succeeded run, not running/failed/queued.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { pool } from "../../db";
import { completionRouter } from "../router";
import { auth } from "../../auth";

// ---------------------------------------------------------------------------
// Fixture IDs — unique per test run to avoid conflicts with live data.
// ---------------------------------------------------------------------------
const RUN_ID = `cpt-${Date.now().toString(36)}`;

const FIXTURE_USER_ID = `${RUN_ID}-user`;
const FIXTURE_OTHER_USER_ID = `${RUN_ID}-other-user`;
const FIXTURE_SUBJECT_ID = `${RUN_ID}-subj`;
const FIXTURE_OTHER_SUBJECT_ID = `${RUN_ID}-other-subj`;
const FIXTURE_SYLLABUS_ID = `${RUN_ID}-syl`;
const FIXTURE_OTHER_SYLLABUS_ID = `${RUN_ID}-other-syl`;
const FIXTURE_UNIT_ID = `${RUN_ID}-unit`;
const FIXTURE_CONCEPT_ID = `${RUN_ID}-cpt`;
const FIXTURE_OTHER_CONCEPT_ID = `${RUN_ID}-other-cpt`;
// Audit runs: one older succeeded, one newer succeeded, one non-succeeded.
const FIXTURE_OLDER_RUN_ID = `${RUN_ID}-run-old`;
const FIXTURE_NEWEST_RUN_ID = `${RUN_ID}-run-new`;
const FIXTURE_FAILED_RUN_ID = `${RUN_ID}-run-fail`;

// ---------------------------------------------------------------------------
// Hono app wired up for integration.
// Session is injected by monkey-patching auth.api.getSession.
// ---------------------------------------------------------------------------
let app: Hono;

// Track the session user returned by the patched getSession.
let currentSessionUserId: string = FIXTURE_USER_ID;

beforeAll(async () => {
  // 1. Users
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Concept User', $2, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_USER_ID, `${RUN_ID}@test.local`],
  );
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Other User', $2, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_OTHER_USER_ID, `${RUN_ID}-other@test.local`],
  );

  // 2. Subjects
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Concept Subject', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SUBJECT_ID, FIXTURE_USER_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'Other Subject', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_OTHER_SUBJECT_ID, FIXTURE_OTHER_USER_ID],
  );

  // 3. Syllabuses
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'cpt/test.pdf', 'test.pdf', true, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_SYLLABUS_ID, FIXTURE_SUBJECT_ID],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'cpt/other.pdf', 'other.pdf', true, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_OTHER_SYLLABUS_ID, FIXTURE_OTHER_SUBJECT_ID],
  );

  // 4. Unit (belongs to FIXTURE_SUBJECT_ID)
  await pool.query(
    `INSERT INTO units (id, subject_id, "order", name, weeks_label)
     VALUES ($1, $2, 3, 'Foundations', 'Weeks 1-2')
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_UNIT_ID, FIXTURE_SUBJECT_ID],
  );

  // 5. Main concept — has unit, LO, syllabus_excerpt, and neighborhood.
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, unit_id, "order", name, learning_objective, syllabus_excerpt, neighborhood, created_at, updated_at)
     VALUES ($1, $2, $3, 1, 'Photosynthesis', 'Understand light reactions.', 'Plants convert light to energy.', $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      FIXTURE_CONCEPT_ID,
      FIXTURE_SYLLABUS_ID,
      FIXTURE_UNIT_ID,
      JSON.stringify(["neighbor-cpt-1", "neighbor-cpt-2"]),
    ],
  );

  // 6. Other-user concept (for 403 test)
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, created_at, updated_at)
     VALUES ($1, $2, 1, 'Other Concept', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_OTHER_CONCEPT_ID, FIXTURE_OTHER_SYLLABUS_ID],
  );

  // 7. Audit runs for FIXTURE_SUBJECT_ID.
  //    older succeeded: finished 2 hours ago
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', '{}', '{}', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours')
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_OLDER_RUN_ID, FIXTURE_SUBJECT_ID, FIXTURE_SYLLABUS_ID],
  );
  //    newest succeeded: finished 1 minute ago (most recent)
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', '{}', '{}', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '1 minute')
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_NEWEST_RUN_ID, FIXTURE_SUBJECT_ID, FIXTURE_SYLLABUS_ID],
  );
  //    failed run: should never be returned as latestRun
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'failed', '{}', '{}', NOW() - INTERVAL '30 seconds', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [FIXTURE_FAILED_RUN_ID, FIXTURE_SUBJECT_ID, FIXTURE_SYLLABUS_ID],
  );

  // Build the test Hono app.
  app = new Hono();

  // Monkey-patch auth.api.getSession — returns null or the current fixture session.
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => {
    if (!currentSessionUserId) return null;
    return {
      user: { id: currentSessionUserId, name: "Test User", email: `${RUN_ID}@test.local` },
      session: {
        id: `${RUN_ID}-session`,
        userId: currentSessionUserId,
        token: `${RUN_ID}-token`,
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
    };
  };

  app.route("/", completionRouter);
});

afterAll(async () => {
  // Clean up in reverse FK order.
  await pool.query(`DELETE FROM audit_runs WHERE id IN ($1, $2, $3)`, [
    FIXTURE_OLDER_RUN_ID,
    FIXTURE_NEWEST_RUN_ID,
    FIXTURE_FAILED_RUN_ID,
  ]);
  await pool.query(`DELETE FROM concepts WHERE id IN ($1, $2)`, [
    FIXTURE_CONCEPT_ID,
    FIXTURE_OTHER_CONCEPT_ID,
  ]);
  await pool.query(`DELETE FROM units WHERE id = $1`, [FIXTURE_UNIT_ID]);
  await pool.query(`DELETE FROM syllabuses WHERE id IN ($1, $2)`, [
    FIXTURE_SYLLABUS_ID,
    FIXTURE_OTHER_SYLLABUS_ID,
  ]);
  await pool.query(`DELETE FROM subjects WHERE id IN ($1, $2)`, [
    FIXTURE_SUBJECT_ID,
    FIXTURE_OTHER_SUBJECT_ID,
  ]);
  await pool.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [
    FIXTURE_USER_ID,
    FIXTURE_OTHER_USER_ID,
  ]);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getConceptReq(conceptId: string): Request {
  return new Request(`http://localhost/api/concepts/${conceptId}`);
}

// ---------------------------------------------------------------------------
// Test 1: 401 without session
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns 401 when unauthenticated", async () => {
  // Override getSession to return null for this request.
  const saved = currentSessionUserId;
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => null;

  const res = await app.fetch(getConceptReq(FIXTURE_CONCEPT_ID));
  expect(res.status).toBe(401);

  // Restore.
  currentSessionUserId = saved;
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => ({
    user: { id: currentSessionUserId, name: "Test User", email: `${RUN_ID}@test.local` },
    session: {
      id: `${RUN_ID}-session`,
      userId: currentSessionUserId,
      token: `${RUN_ID}-token`,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
    },
  });
});

// ---------------------------------------------------------------------------
// Test 2: 403 when concept belongs to a different user
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns 403 for a concept owned by another user", async () => {
  // Authenticate as the primary user but request a concept owned by OTHER user.
  currentSessionUserId = FIXTURE_USER_ID;
  const res = await app.fetch(getConceptReq(FIXTURE_OTHER_CONCEPT_ID));
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Test 3: 404 when concept does not exist
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns 404 for a non-existent concept", async () => {
  currentSessionUserId = FIXTURE_USER_ID;
  const res = await app.fetch(getConceptReq("does-not-exist-concept-id"));
  expect(res.status).toBe(404);
});

// ---------------------------------------------------------------------------
// Test 4: 200 with full ConceptDetail shape
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns 200 with full ConceptDetail", async () => {
  currentSessionUserId = FIXTURE_USER_ID;
  const res = await app.fetch(getConceptReq(FIXTURE_CONCEPT_ID));
  expect(res.status).toBe(200);

  const body = (await res.json()) as {
    concept: {
      id: string;
      name: string;
      learningObjective: string | null;
      syllabusExcerpt: string | null;
      neighborhood: string[] | null;
      unit: { id: string; name: string; order: number; weeksLabel: string | null } | null;
      subject: { id: string; name: string; course: string | null };
      latestRun: { id: string } | null;
    };
  };

  const { concept } = body;
  expect(concept.id).toBe(FIXTURE_CONCEPT_ID);
  expect(concept.name).toBe("Photosynthesis");
  expect(concept.learningObjective).toBe("Understand light reactions.");
  expect(concept.syllabusExcerpt).toBe("Plants convert light to energy.");
  expect(concept.neighborhood).toEqual(["neighbor-cpt-1", "neighbor-cpt-2"]);

  // Unit shape
  expect(concept.unit).not.toBeNull();
  expect(concept.unit!.id).toBe(FIXTURE_UNIT_ID);
  expect(concept.unit!.name).toBe("Foundations");
  expect(concept.unit!.order).toBe(3);
  expect(concept.unit!.weeksLabel).toBe("Weeks 1-2");

  // Subject shape
  expect(concept.subject.id).toBe(FIXTURE_SUBJECT_ID);
  expect(concept.subject.name).toBe("Concept Subject");
  expect(concept.subject.course).toBeNull();
});

// ---------------------------------------------------------------------------
// Test 5: latestRun is null when no succeeded audit run exists
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns latestRun: null when no succeeded run exists", async () => {
  // Seed a subject + syllabus + concept with no audit runs.
  const noRunSubjectId = `${RUN_ID}-norun-subj`;
  const noRunSyllabusId = `${RUN_ID}-norun-syl`;
  const noRunConceptId = `${RUN_ID}-norun-cpt`;

  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'No-Run Subject', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [noRunSubjectId, FIXTURE_USER_ID],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'nr/test.pdf', 'test.pdf', true, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [noRunSyllabusId, noRunSubjectId],
  );
  await pool.query(
    `INSERT INTO concepts (id, syllabus_id, "order", name, created_at, updated_at)
     VALUES ($1, $2, 1, 'No-Run Concept', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [noRunConceptId, noRunSyllabusId],
  );

  try {
    currentSessionUserId = FIXTURE_USER_ID;
    const res = await app.fetch(getConceptReq(noRunConceptId));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { concept: { latestRun: { id: string } | null } };
    expect(body.concept.latestRun).toBeNull();
  } finally {
    await pool.query(`DELETE FROM concepts WHERE id = $1`, [noRunConceptId]);
    await pool.query(`DELETE FROM syllabuses WHERE id = $1`, [noRunSyllabusId]);
    await pool.query(`DELETE FROM subjects WHERE id = $1`, [noRunSubjectId]);
  }
});

// ---------------------------------------------------------------------------
// Test 6: latestRun: { id } when a succeeded run exists
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id returns latestRun with the most recent succeeded run id", async () => {
  currentSessionUserId = FIXTURE_USER_ID;
  const res = await app.fetch(getConceptReq(FIXTURE_CONCEPT_ID));
  expect(res.status).toBe(200);

  const body = (await res.json()) as { concept: { latestRun: { id: string } | null } };
  expect(body.concept.latestRun).not.toBeNull();
  expect(body.concept.latestRun!.id).toBe(FIXTURE_NEWEST_RUN_ID);
});

// ---------------------------------------------------------------------------
// Test 7: Returns the most recent succeeded run — not running/failed/queued
// ---------------------------------------------------------------------------
test("GET /api/concepts/:id does not return non-succeeded runs as latestRun", async () => {
  currentSessionUserId = FIXTURE_USER_ID;
  const res = await app.fetch(getConceptReq(FIXTURE_CONCEPT_ID));
  expect(res.status).toBe(200);

  const body = (await res.json()) as { concept: { latestRun: { id: string } | null } };
  // The failed run (FIXTURE_FAILED_RUN_ID) must not be returned even though it
  // has the most recent finished_at timestamp — only 'succeeded' rows are eligible.
  expect(body.concept.latestRun!.id).not.toBe(FIXTURE_FAILED_RUN_ID);
  // The newest succeeded run must win over the older succeeded run.
  expect(body.concept.latestRun!.id).toBe(FIXTURE_NEWEST_RUN_ID);
});
