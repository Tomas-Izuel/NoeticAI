import { Hono } from "hono";
import { auth } from "../auth";
import { pool } from "../db";

export const subjectsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/subjects — list subjects for the authenticated user
//
// Response shape:
//   { subjects: Array<{ id, name, course, term, glyph, totals }> }
//
// `totals.concepts` is always the active-syllabus concept count (so the tray
// can show "0/47 engaged" even before the first audit run).
// `totals.covered/partial/missing` come from the latest succeeded audit run's
// mastery_scores; zeroed when no such run exists.
//
// SQL approach: two queries (subjects list + per-subject aggregate) rather
// than one giant CTE — the aggregate already does enough work with three
// joins; folding the subjects select in would hurt readability for no gain
// at typical user scale (< 20 subjects per user).
// ---------------------------------------------------------------------------

subjectsRouter.get("/api/subjects", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const rows = await pool.query<{
    id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
  }>(
    `SELECT id, name, course, term, glyph
     FROM subjects
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  if (rows.rows.length === 0) {
    return c.json({ subjects: [] });
  }

  const subjectIds = rows.rows.map((r) => r.id);

  // Aggregate totals per subject in a single query.
  //
  // Structure:
  //   latest_runs CTE — one succeeded audit_run per subject (most recent by finished_at)
  //   main SELECT  — LEFT JOIN syllabuses → concepts for syllabus count
  //                  LEFT JOIN latest_runs → mastery_scores for covered/partial/missing
  //
  // mastery_scores rows only exist when a run is present, so the conditional
  // aggregation naturally produces 0 for all three states when the CTE yields
  // no row for a given subject.
  const totalsRes = await pool.query<{
    subject_id: string;
    concepts: string; // postgres COUNT returns bigint → string in node-postgres
    covered: string;
    partial: string;
    missing: string;
  }>(
    `WITH latest_runs AS (
       SELECT DISTINCT ON (subject_id)
              id AS run_id, subject_id
       FROM   audit_runs
       WHERE  subject_id = ANY($1::text[])
         AND  status = 'succeeded'
       ORDER  BY subject_id, finished_at DESC
     )
     SELECT
       s.id AS subject_id,
       COUNT(DISTINCT c.id)                                               AS concepts,
       COUNT(DISTINCT CASE WHEN ms.state = 'green' THEN ms.concept_id END) AS covered,
       COUNT(DISTINCT CASE WHEN ms.state = 'amber' THEN ms.concept_id END) AS partial,
       COUNT(DISTINCT CASE WHEN ms.state = 'red'   THEN ms.concept_id END) AS missing
     FROM   subjects s
     LEFT JOIN syllabuses sy
            ON sy.subject_id = s.id AND sy.is_active = TRUE
     LEFT JOIN concepts c
            ON c.syllabus_id = sy.id
     LEFT JOIN latest_runs lr
            ON lr.subject_id = s.id
     LEFT JOIN mastery_scores ms
            ON ms.audit_run_id = lr.run_id
           AND ms.concept_id   = c.id
     WHERE  s.id = ANY($1::text[])
     GROUP  BY s.id`,
    [subjectIds],
  );

  const totalsMap = new Map(
    totalsRes.rows.map((r) => [
      r.subject_id,
      {
        concepts: parseInt(r.concepts, 10),
        covered: parseInt(r.covered, 10),
        partial: parseInt(r.partial, 10),
        missing: parseInt(r.missing, 10),
      },
    ]),
  );

  const zero = { concepts: 0, covered: 0, partial: 0, missing: 0 };

  return c.json({
    subjects: rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      course: r.course,
      term: r.term,
      glyph: r.glyph,
      totals: totalsMap.get(r.id) ?? zero,
    })),
  });
});
