/**
 * Integration tests for GET /api/subjects (Phase 5 nav extension).
 *
 * Covers:
 *   1. 401 when unauthenticated (no session).
 *   2. User with zero subjects → { subjects: [] }.
 *   3. Subject with no syllabus → totals all zero.
 *   4. Subject with active syllabus but no audit run → concepts = syllabus count, others 0.
 *   5. Subject with a succeeded audit run → totals match mastery_scores aggregation.
 *   6. Cross-user isolation — endpoint returns only the requesting user's subjects.
 *
 * Prerequisites: Postgres running at DATABASE_URL with all migrations applied.
 * Run with: bun test src/subjects/__tests__/router.test.ts
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { pool } from "../../db";
import { subjectsRouter } from "../router";
import { auth } from "../../auth";

// ---------------------------------------------------------------------------
// Fixture IDs — unique per test run to avoid conflicts with live data.
// ---------------------------------------------------------------------------
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function id(prefix: string): string {
  return `subj-test-${prefix}-${RUN_ID}`;
}

// Two users: the requesting user (A) and an unrelated user (B).
const USER_A = id("userA");
const USER_B = id("userB");

// Subject A1: no syllabus (totals all zero).
const SUBJ_NO_SYL = id("nosyl");

// Subject A2: active syllabus, no audit run.
const SUBJ_SYL_NO_RUN = id("sylnorun");
const SYL_NO_RUN = id("syl-nr");
// Three concepts in that syllabus.
const CONCEPT_NR_1 = id("cnr1");
const CONCEPT_NR_2 = id("cnr2");
const CONCEPT_NR_3 = id("cnr3");

// Subject A3: active syllabus + succeeded audit run with mastery scores.
const SUBJ_WITH_RUN = id("withrun");
const SYL_WITH_RUN = id("syl-wr");
const AUDIT_RUN = id("ar");
// Two concepts: one green, one red.
const CONCEPT_WR_GREEN = id("cwrg");
const CONCEPT_WR_RED = id("cwrr");

// Subject B: belongs to user B — must not appear in user A's response.
const SUBJ_B = id("subjB");

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
let app: Hono;
let currentUserId: string = USER_A; // controlled per-test via the session mock

beforeAll(async () => {
  // --- users ---
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Test User A', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [USER_A, `subj-a-${RUN_ID}@test.local`],
  );
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Test User B', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [USER_B, `subj-b-${RUN_ID}@test.local`],
  );

  // --- subject: no syllabus ---
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, glyph, term, created_at, updated_at)
     VALUES ($1, $2, 'No Syllabus Subject', '📚', 'Q1', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SUBJ_NO_SYL, USER_A],
  );

  // --- subject: active syllabus, no audit run ---
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, glyph, term, created_at, updated_at)
     VALUES ($1, $2, 'No Run Subject', '🔬', 'Q2', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SUBJ_SYL_NO_RUN, USER_A],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'test/norun.pdf', 'norun.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [SYL_NO_RUN, SUBJ_SYL_NO_RUN],
  );
  for (const cid of [CONCEPT_NR_1, CONCEPT_NR_2, CONCEPT_NR_3]) {
    await pool.query(
      `INSERT INTO concepts (id, syllabus_id, "order", name, created_at, updated_at)
       VALUES ($1, $2, 1, 'Concept', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      [cid, SYL_NO_RUN],
    );
  }

  // --- subject: active syllabus + succeeded audit run ---
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, glyph, term, created_at, updated_at)
     VALUES ($1, $2, 'With Run Subject', '⚡', 'Q3', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SUBJ_WITH_RUN, USER_A],
  );
  await pool.query(
    `INSERT INTO syllabuses (id, subject_id, version, status, source_path, source_filename, is_active, created_at)
     VALUES ($1, $2, 1, 'confirmed', 'test/run.pdf', 'run.pdf', true, NOW()) ON CONFLICT (id) DO NOTHING`,
    [SYL_WITH_RUN, SUBJ_WITH_RUN],
  );
  for (const cid of [CONCEPT_WR_GREEN, CONCEPT_WR_RED]) {
    await pool.query(
      `INSERT INTO concepts (id, syllabus_id, "order", name, created_at, updated_at)
       VALUES ($1, $2, 1, 'Concept', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
      [cid, SYL_WITH_RUN],
    );
  }
  await pool.query(
    `INSERT INTO audit_runs (id, subject_id, syllabus_id, status, thresholds_json, models_json, started_at, finished_at)
     VALUES ($1, $2, $3, 'succeeded', $4, $5, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [
      AUDIT_RUN,
      SUBJ_WITH_RUN,
      SYL_WITH_RUN,
      JSON.stringify({ greenDepth: 0.7, amberDepth: 0.4, minFragmentsForGreen: 2, conflictMinFragments: 3, hallucinationGuardSimilarity: 0.85 }),
      JSON.stringify({ embed: "test-embed", haiku: "test-haiku" }),
    ],
  );
  // mastery: green + red
  await pool.query(
    `INSERT INTO mastery_scores (concept_id, audit_run_id, state, depth, mentions, sources, fragments, conflict)
     VALUES ($1, $2, 'green', 0.8, 5, 2, 10, false) ON CONFLICT (concept_id, audit_run_id) DO NOTHING`,
    [CONCEPT_WR_GREEN, AUDIT_RUN],
  );
  await pool.query(
    `INSERT INTO mastery_scores (concept_id, audit_run_id, state, depth, mentions, sources, fragments, conflict)
     VALUES ($1, $2, 'red', 0.1, 0, 0, 0, false) ON CONFLICT (concept_id, audit_run_id) DO NOTHING`,
    [CONCEPT_WR_RED, AUDIT_RUN],
  );

  // --- subject: user B (must not appear in A's response) ---
  await pool.query(
    `INSERT INTO subjects (id, user_id, name, created_at, updated_at)
     VALUES ($1, $2, 'User B Subject', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [SUBJ_B, USER_B],
  );

  // Build the test app.
  app = new Hono();

  // Monkey-patch auth.api.getSession to return whoever currentUserId points to.
  // biome-ignore lint: test-only cast
  (auth.api as Record<string, unknown>)["getSession"] = async () => {
    if (!currentUserId) return null;
    return {
      user: { id: currentUserId, name: "Test User", email: `${currentUserId}@test.local` },
      session: {
        id: "test-session",
        userId: currentUserId,
        token: "test-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
    };
  };

  app.route("/", subjectsRouter);
});

afterAll(async () => {
  // Clean up in reverse FK order.
  await pool.query(`DELETE FROM mastery_scores WHERE audit_run_id = $1`, [AUDIT_RUN]);
  await pool.query(`DELETE FROM audit_runs WHERE id = $1`, [AUDIT_RUN]);
  for (const cid of [CONCEPT_WR_GREEN, CONCEPT_WR_RED]) {
    await pool.query(`DELETE FROM concepts WHERE id = $1`, [cid]);
  }
  for (const cid of [CONCEPT_NR_1, CONCEPT_NR_2, CONCEPT_NR_3]) {
    await pool.query(`DELETE FROM concepts WHERE id = $1`, [cid]);
  }
  await pool.query(`DELETE FROM syllabuses WHERE id IN ($1, $2)`, [SYL_NO_RUN, SYL_WITH_RUN]);
  await pool.query(`DELETE FROM subjects WHERE id IN ($1, $2, $3, $4)`, [SUBJ_NO_SYL, SUBJ_SYL_NO_RUN, SUBJ_WITH_RUN, SUBJ_B]);
  await pool.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [USER_A, USER_B]);
  await pool.end();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

interface SubjectTotals {
  concepts: number;
  covered: number;
  partial: number;
  missing: number;
}

interface SubjectShape {
  id: string;
  name: string;
  course: string | null;
  term: string | null;
  glyph: string | null;
  totals: SubjectTotals;
}

async function getSubjects(userId: string | null): Promise<Response> {
  currentUserId = userId ?? "";
  // biome-ignore lint: test-only — null signals unauthenticated
  (auth.api as Record<string, unknown>)["getSession"] = async () => {
    if (!userId) return null;
    return {
      user: { id: userId, name: "Test User", email: `${userId}@test.local` },
      session: {
        id: "test-session",
        userId,
        token: "test-token",
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        ipAddress: null,
        userAgent: null,
      },
    };
  };

  return app.fetch(new Request("http://localhost/api/subjects"));
}

// ---------------------------------------------------------------------------
// Test 1: 401 when unauthenticated
// ---------------------------------------------------------------------------

test("GET /api/subjects returns 401 when not authenticated", async () => {
  const res = await getSubjects(null);
  expect(res.status).toBe(401);
  const body = (await res.json()) as { error: string };
  expect(body.error).toBe("unauthenticated");
});

// ---------------------------------------------------------------------------
// Test 2: User with zero subjects
// ---------------------------------------------------------------------------

test("GET /api/subjects returns empty array when user has no subjects", async () => {
  // Create a brand-new user with no subjects.
  const emptyUserId = id("empty");
  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ($1, 'Empty User', $2, true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
    [emptyUserId, `empty-${RUN_ID}@test.local`],
  );

  try {
    const res = await getSubjects(emptyUserId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subjects: SubjectShape[] };
    expect(body.subjects).toEqual([]);
  } finally {
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [emptyUserId]);
  }
});

// ---------------------------------------------------------------------------
// Test 3: Subject with no syllabus → totals all zero
// ---------------------------------------------------------------------------

test("GET /api/subjects — subject with no syllabus has totals all zero", async () => {
  const res = await getSubjects(USER_A);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { subjects: SubjectShape[] };

  const subject = body.subjects.find((s) => s.id === SUBJ_NO_SYL);
  expect(subject).toBeDefined();
  expect(subject!.glyph).toBe("📚");
  expect(subject!.term).toBe("Q1");
  expect(subject!.totals).toEqual({ concepts: 0, covered: 0, partial: 0, missing: 0 });
});

// ---------------------------------------------------------------------------
// Test 4: Subject with active syllabus but no audit run
//   → concepts = syllabus concept count, covered/partial/missing all zero
// ---------------------------------------------------------------------------

test("GET /api/subjects — subject with syllabus but no audit run has concepts count from syllabus", async () => {
  const res = await getSubjects(USER_A);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { subjects: SubjectShape[] };

  const subject = body.subjects.find((s) => s.id === SUBJ_SYL_NO_RUN);
  expect(subject).toBeDefined();
  expect(subject!.glyph).toBe("🔬");
  expect(subject!.term).toBe("Q2");
  expect(subject!.totals).toEqual({ concepts: 3, covered: 0, partial: 0, missing: 0 });
});

// ---------------------------------------------------------------------------
// Test 5: Subject with succeeded audit run → totals match mastery_scores
// ---------------------------------------------------------------------------

test("GET /api/subjects — subject with succeeded audit run has correct totals", async () => {
  const res = await getSubjects(USER_A);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { subjects: SubjectShape[] };

  const subject = body.subjects.find((s) => s.id === SUBJ_WITH_RUN);
  expect(subject).toBeDefined();
  expect(subject!.glyph).toBe("⚡");
  expect(subject!.term).toBe("Q3");
  // 2 concepts total in syllabus; 1 green, 1 red, 0 amber.
  expect(subject!.totals).toEqual({ concepts: 2, covered: 1, partial: 0, missing: 1 });
});

// ---------------------------------------------------------------------------
// Test 6: Cross-user isolation — user A cannot see user B's subjects
// ---------------------------------------------------------------------------

test("GET /api/subjects — does not return another user's subjects", async () => {
  const res = await getSubjects(USER_A);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { subjects: SubjectShape[] };

  const ids = body.subjects.map((s) => s.id);
  expect(ids).not.toContain(SUBJ_B);

  // All returned subjects must belong to user A.
  for (const s of body.subjects) {
    expect([SUBJ_NO_SYL, SUBJ_SYL_NO_RUN, SUBJ_WITH_RUN]).toContain(s.id);
  }
});
