import type { Thresholds } from "@noeticai/audit-core";
import { pool } from "../db";

export interface ScoringInput {
  auditRunId: string;
  syllabusId: string;
  thresholds: Thresholds;
}

export interface ScoringResult {
  scoredConcepts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
}

/**
 * For every concept in the syllabus (whether or not it received any links),
 * compute mentions / sources / fragments / depth, derive state, and INSERT
 * a row into mastery_scores.
 *
 * Single SQL query: GROUP BY concept_id over the run's links, aggregating
 * verdicts. LEFT JOIN against concepts so concepts with zero links emit
 * a (mentions=0, sources=0, depth=0, state=red) row.
 *
 * Conflict detection deferred to Phase 7b — emits conflict=false for all rows.
 *
 * Note: the state derivation here mirrors deriveState() from @noeticai/audit-core.
 * deriveState() remains the source of truth for web-side threshold previews.
 * If the SQL state formula ever drifts from deriveState(), that is a bug —
 * the score.test.ts Vitest asserts both produce identical results for a grid
 * of (depth, mentions) pairs.
 */
export async function runScoring(input: ScoringInput): Promise<ScoringResult> {
  const { auditRunId, syllabusId, thresholds } = input;

  await pool.query(
    `INSERT INTO mastery_scores (
       audit_run_id, concept_id, state, depth, mentions, sources, fragments, conflict
     )
     SELECT
       $1 AS audit_run_id,
       c.id AS concept_id,
       CASE
         WHEN COALESCE(agg.depth, 0) >= $2 AND COALESCE(agg.mentions, 0) >= $3 THEN 'green'
         WHEN COALESCE(agg.depth, 0) >= $4 OR COALESCE(agg.mentions, 0) = 1     THEN 'amber'
         ELSE 'red'
       END AS state,
       COALESCE(agg.depth, 0) AS depth,
       COALESCE(agg.mentions, 0) AS mentions,
       COALESCE(agg.sources, 0) AS sources,
       COALESCE(agg.mentions, 0) AS fragments,
       FALSE AS conflict
     FROM concepts c
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (
           WHERE l.verdict IN ('engages', 'mentions')
         )::int AS mentions,
         COUNT(DISTINCT n.id) FILTER (
           WHERE l.verdict IN ('engages', 'mentions')
         )::int AS sources,
         GREATEST(
           COALESCE(MAX(l.similarity) FILTER (WHERE l.verdict = 'engages'),     0)::numeric,
           COALESCE(MAX(l.similarity) FILTER (WHERE l.verdict = 'mentions') * 0.4, 0)::numeric
         ) AS depth
       FROM concept_fragment_links l
       JOIN note_fragments nf ON nf.id = l.fragment_id
       JOIN notes n ON n.id = nf.note_id
       WHERE l.audit_run_id = $1 AND l.concept_id = c.id
     ) agg ON TRUE
     WHERE c.syllabus_id = $5
     ON CONFLICT (audit_run_id, concept_id) DO UPDATE SET
       state     = EXCLUDED.state,
       depth     = EXCLUDED.depth,
       mentions  = EXCLUDED.mentions,
       sources   = EXCLUDED.sources,
       fragments = EXCLUDED.fragments,
       conflict  = EXCLUDED.conflict`,
    [
      auditRunId,
      thresholds.greenDepth,
      thresholds.minFragmentsForGreen,
      thresholds.amberDepth,
      syllabusId,
    ],
  );

  // Count per state for the telemetry result.
  const countRes = await pool.query<{ state: string; cnt: string }>(
    `SELECT state, COUNT(*) AS cnt
     FROM mastery_scores
     WHERE audit_run_id = $1
     GROUP BY state`,
    [auditRunId],
  );

  let greenCount = 0;
  let amberCount = 0;
  let redCount = 0;

  for (const row of countRes.rows) {
    const n = parseInt(row.cnt, 10);
    if (row.state === "green") greenCount = n;
    else if (row.state === "amber") amberCount = n;
    else if (row.state === "red") redCount = n;
  }

  return {
    scoredConcepts: greenCount + amberCount + redCount,
    greenCount,
    amberCount,
    redCount,
  };
}
