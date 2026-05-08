import { pool } from "../db";
import { embed } from "../ai";
import { runAlignment } from "./align";
import { runScoring } from "./score";
import { runGaps } from "./gaps";
import type { Thresholds } from "@noeticai/audit-core";

export interface AuditJobInput {
  auditRunId: string;
}

export interface AuditJobResult {
  auditRunId: string;
  candidatesConsidered: number;
  linksPersisted: number;
  haikuCalls: number;
  scoredConcepts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  gapsOpened: number;
  gapsRefreshed: number;
  durationMs: number;
}

/**
 * Core audit orchestrator. Updates audit_runs.status across the lifecycle
 * and runs alignment → scoring → gaps in order.
 *
 * Lifecycle:
 *   queued  →  running          (UPDATE at start)
 *   running →  succeeded        (UPDATE after gaps step)
 *   running →  failed           (catch in processAuditJob; persists failure_reason)
 *
 * No transaction wrapping — each step is individually idempotent via UPSERT.
 * A crash mid-run leaves partial state visible; the next run overwrites it.
 */
export async function runAuditJob(
  input: AuditJobInput,
): Promise<AuditJobResult> {
  const startedAt = performance.now();
  const { auditRunId } = input;

  // 1. Load the audit_runs row.
  const runRows = await pool.query<{
    subject_id: string;
    syllabus_id: string;
    thresholds_json: Thresholds;
    models_json: { embed: string; haiku: string };
  }>(
    `SELECT subject_id, syllabus_id, thresholds_json, models_json
     FROM audit_runs WHERE id = $1`,
    [auditRunId],
  );

  const runRow = runRows.rows[0];
  if (!runRow) {
    throw new Error(`audit_run id=${auditRunId} not found`);
  }

  const { subject_id: subjectId, syllabus_id: syllabusId } = runRow;
  const thresholds: Thresholds = runRow.thresholds_json;

  // 2. Set status = 'running' and re-snapshot the embed model_id.
  // Re-snapshotting guards against a hot env-flip between enqueue and run.
  const currentModelId = embed.defaultModelId;
  const updatedModelsJson = { ...runRow.models_json, embed: currentModelId };

  await pool.query(
    `UPDATE audit_runs
     SET status = 'running', models_json = $2
     WHERE id = $1`,
    [auditRunId, JSON.stringify(updatedModelsJson)],
  );

  // 3. Stage 1 + 2 alignment: cosine retrieval → Haiku verdict → persist links.
  const alignResult = await runAlignment({
    auditRunId,
    subjectId,
    syllabusId,
    modelId: currentModelId,
    thresholds: { amberSimilarity: thresholds.amberDepth },
  });

  // 4. Scoring: aggregate links into mastery_scores.
  const scoreResult = await runScoring({
    auditRunId,
    syllabusId,
    thresholds,
  });

  // 5. Gaps: open/refresh gap rows for amber/red concepts.
  const gapsResult = await runGaps({ auditRunId, syllabusId });

  // 6. Mark succeeded.
  await pool.query(
    `UPDATE audit_runs
     SET status = 'succeeded', finished_at = NOW()
     WHERE id = $1`,
    [auditRunId],
  );

  const durationMs = Math.round(performance.now() - startedAt);

  console.log(
    `[audit:job] run=${auditRunId} done in ${durationMs}ms — ` +
      `candidates=${alignResult.candidatesConsidered} links=${alignResult.linksPersisted} ` +
      `haiku=${alignResult.haikuCalls} scored=${scoreResult.scoredConcepts} ` +
      `green=${scoreResult.greenCount} amber=${scoreResult.amberCount} red=${scoreResult.redCount} ` +
      `gaps_opened=${gapsResult.opened} gaps_refreshed=${gapsResult.refreshed}`,
  );

  return {
    auditRunId,
    candidatesConsidered: alignResult.candidatesConsidered,
    linksPersisted: alignResult.linksPersisted,
    haikuCalls: alignResult.haikuCalls,
    scoredConcepts: scoreResult.scoredConcepts,
    greenCount: scoreResult.greenCount,
    amberCount: scoreResult.amberCount,
    redCount: scoreResult.redCount,
    gapsOpened: gapsResult.opened,
    gapsRefreshed: gapsResult.refreshed,
    durationMs,
  };
}

/**
 * Wraps runAuditJob; sets audit_runs.status='failed' + failure_reason on
 * any error before re-throwing (mirrors processSyllabusJob's pattern).
 */
export async function processAuditJob(
  input: AuditJobInput,
): Promise<AuditJobResult> {
  try {
    return await runAuditJob(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort DB write — don't let a secondary failure obscure the original.
    try {
      await pool.query(
        `UPDATE audit_runs
         SET status = 'failed', failure_reason = $2
         WHERE id = $1`,
        [input.auditRunId, message],
      );
    } catch {
      // ignore secondary failure
    }
    throw err;
  }
}
