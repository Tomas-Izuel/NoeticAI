import { pool } from "../db";

export interface GapsInput {
  auditRunId: string;
  syllabusId: string;
}

export interface GapsResult {
  opened: number;       // brand-new gap rows inserted
  refreshed: number;    // existing open gap rows updated
}

/**
 * For every concept whose mastery_scores.state ∈ {amber, red} in this run:
 *
 *   - If a gap row exists for the concept with status='open', UPDATE its
 *     current_state, latest_run_id, last_seen_at.
 *   - Else INSERT a new gap row with first_detected_in_run=auditRunId.
 *
 * Concepts whose state is now 'green' DO NOT close their open gap. Closing
 * is a user action (Phase 5/6: "merge completion" or "dismiss"). This
 * function is one-way.
 *
 * Uses the gaps_concept_open_uq partial unique index for the UPSERT:
 *   ON CONFLICT (concept_id) WHERE status = 'open'
 *
 * Gap id is deterministic: sha256(auditRunId || conceptId) — only used on
 * first insert; preserved on subsequent updates.
 */
export async function runGaps(input: GapsInput): Promise<GapsResult> {
  const { auditRunId, syllabusId } = input;

  const result = await pool.query<{ xmax: string }>(
    `INSERT INTO gaps (
       id, concept_id, first_detected_in_run, latest_run_id,
       current_state, status, first_detected_at, last_seen_at
     )
     SELECT
       encode(sha256(($1::text || ms.concept_id)::bytea), 'hex')::text,
       ms.concept_id,
       $1,
       $1,
       ms.state,
       'open',
       NOW(),
       NOW()
     FROM mastery_scores ms
     JOIN concepts c ON c.id = ms.concept_id
     WHERE ms.audit_run_id = $1
       AND c.syllabus_id = $2
       AND ms.state IN ('amber', 'red')
     ON CONFLICT (concept_id) WHERE status = 'open'
     DO UPDATE SET
       current_state = EXCLUDED.current_state,
       latest_run_id = EXCLUDED.latest_run_id,
       last_seen_at  = NOW()
     RETURNING xmax`,
    [auditRunId, syllabusId],
  );

  let opened = 0;
  let refreshed = 0;

  for (const row of result.rows) {
    // xmax = 0 means the row was freshly inserted; > 0 means it was updated.
    if (row.xmax === "0") {
      opened += 1;
    } else {
      refreshed += 1;
    }
  }

  return { opened, refreshed };
}
