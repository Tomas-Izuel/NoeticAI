/**
 * Phase 3 eval gate (phase3-plan.md §10.1):
 *   - Gap precision and recall both ≥ 0.85 on the Phase-1 stub fixture.
 *   - Golden gap set is hand-labelled per concept for the 8 Spanish stub notes.
 *   - On Ollama: expect noisy gap sets (verdicts differ from Bedrock) — smoke only.
 *   - Self-skips if NOETICAI_EVAL_LIVE != "1" or gaps-golden.json is absent.
 *
 * gaps-golden.json shape:
 * {
 *   "subjectId": string,
 *   "openGapConceptIds": string[]   -- concept ids that should have status='open' after an audit
 * }
 */
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { pool } from "../src/db";
import { env } from "../src/env";

const EVAL_DIR = import.meta.dir;
const GOLDEN_JSON = join(EVAL_DIR, "gaps-golden.json");

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const PRECISION_RECALL_GATE = 0.85;

const GoldenSchema = z.object({
  subjectId: z.string(),
  openGapConceptIds: z.array(z.string()),
});

test("gap precision and recall gate", async () => {
  if (!LIVE) {
    console.log("[eval:gaps] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (!existsSync(GOLDEN_JSON)) {
    console.log("[eval:gaps] gaps-golden.json not found — skipping.");
    return;
  }

  const raw = readFileSync(GOLDEN_JSON, "utf-8");
  const golden = GoldenSchema.parse(JSON.parse(raw));

  // Pull the latest succeeded run for the fixture subject.
  const runRows = await pool.query<{ id: string }>(
    `SELECT id FROM audit_runs
     WHERE subject_id = $1 AND status = 'succeeded'
     ORDER BY finished_at DESC LIMIT 1`,
    [golden.subjectId],
  );
  const latestRun = runRows.rows[0];
  if (!latestRun) {
    console.warn(
      `[eval:gaps] No succeeded audit run found for subjectId=${golden.subjectId}. ` +
        `Run an audit first.`,
    );
    return;
  }

  // Pull open gap concept ids for this subject.
  const gapRows = await pool.query<{ concept_id: string }>(
    `SELECT g.concept_id
     FROM gaps g
     JOIN concepts c ON c.id = g.concept_id
     JOIN syllabuses s ON s.id = c.syllabus_id
     WHERE s.subject_id = $1 AND g.status = 'open'`,
    [golden.subjectId],
  );

  const emittedSet = new Set(gapRows.rows.map((r) => r.concept_id));
  const expectedSet = new Set(golden.openGapConceptIds);

  const truePositives = [...emittedSet].filter((id) => expectedSet.has(id)).length;
  const precision = emittedSet.size === 0 ? 0 : truePositives / emittedSet.size;
  const recall = expectedSet.size === 0 ? 1 : truePositives / expectedSet.size;

  const backend = env.NOETICAI_AI_BACKEND;

  console.log(
    `[eval:gaps] backend=${backend} ` +
      `precision=${(precision * 100).toFixed(1)}% ` +
      `recall=${(recall * 100).toFixed(1)}% ` +
      `emitted=${emittedSet.size} expected=${expectedSet.size} tp=${truePositives}`,
  );

  if (backend === "bedrock") {
    expect(precision).toBeGreaterThanOrEqual(PRECISION_RECALL_GATE);
    expect(recall).toBeGreaterThanOrEqual(PRECISION_RECALL_GATE);
  } else {
    console.log(
      `[eval:gaps] Ollama backend — precision/recall gate (${PRECISION_RECALL_GATE}) not enforced.`,
    );
  }
});
