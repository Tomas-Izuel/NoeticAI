/**
 * Phase 4 eval gate — idempotency check (phase4-plan.md §10.3 point 4):
 *
 *   After a successful ingest, calling runSourceIngestJob again on the same
 *   source row produces zero new source_chunks and zero new
 *   source_chunk_embeddings. The skip-if-already-embedded logic is working.
 *
 * Requires live infra AND source-fixture.pdf. Set NOETICAI_EVAL_LIVE=1.
 * Without it, this test self-skips.
 */
import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../src/db";
import { runSourceIngestJob } from "../src/bibliography/job";

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const FIXTURE_PATH = join(import.meta.dir, "source-fixture.pdf");

test("Phase 4 source-ingest rerun: no new chunks or embeddings", async () => {
  if (!LIVE) {
    console.log("skipping live eval — set NOETICAI_EVAL_LIVE=1 to run");
    return;
  }

  if (!existsSync(FIXTURE_PATH)) {
    console.log(
      "skipping — source-fixture.pdf not present. See __eval__/README.md for instructions.",
    );
    return;
  }

  // Resolve a real user_id.
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM "user" ORDER BY created_at ASC LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) throw new Error("no users found — sign up via the web UI first");

  // Resolve subject.
  const subjectRows = await pool.query<{ id: string }>(
    `SELECT id FROM subjects WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  let subjectId = subjectRows.rows[0]?.id;
  if (!subjectId) {
    const { createHash } = await import("node:crypto");
    subjectId = createHash("sha256").update(userId + "eval-subject").digest("hex").slice(0, 24);
    await pool.query(
      `INSERT INTO subjects (id, user_id, name, lang) VALUES ($1, $2, 'Eval Subject', 'en') ON CONFLICT (id) DO NOTHING`,
      [subjectId, userId],
    );
  }

  // Build the same deterministic sourceId used in source-recall.test.ts.
  const { createHash } = await import("node:crypto");
  const sourceTitle = "BonJour 1985 — The Structure of Empirical Knowledge";
  const fixtureRelPath = "uploads/sources/eval-fixture.pdf";
  const sourceId = createHash("sha256")
    .update(subjectId + "pdf" + fixtureRelPath)
    .digest("hex")
    .slice(0, 24);

  // Ensure source row exists (may already be there from source-recall test).
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, source_path, source_filename)
     VALUES ($1, $2, 'pdf', $3, 'ready', $4, 'source-fixture.pdf')
     ON CONFLICT (id) DO NOTHING`,
    [sourceId, subjectId, sourceTitle, fixtureRelPath],
  );

  // Count before rerun.
  const chunksBefore = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM source_chunks WHERE source_id = $1`,
    [sourceId],
  );
  const embedsBefore = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     WHERE sc.source_id = $1`,
    [sourceId],
  );
  const countBefore = parseInt(chunksBefore.rows[0]?.n ?? "0", 10);
  const embedCountBefore = parseInt(embedsBefore.rows[0]?.n ?? "0", 10);

  // Sanity: the prior run should have produced some chunks.
  expect(countBefore).toBeGreaterThan(0);

  // Reset status so the job runs again (ON CONFLICT DO NOTHING guards actual data).
  await pool.query(
    `UPDATE sources SET status = 'uploading', failure_reason = NULL, updated_at = NOW() WHERE id = $1`,
    [sourceId],
  );

  // Rerun.
  await runSourceIngestJob({ sourceId, userId });

  // Count after rerun.
  const chunksAfter = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM source_chunks WHERE source_id = $1`,
    [sourceId],
  );
  const embedsAfter = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     WHERE sc.source_id = $1`,
    [sourceId],
  );
  const countAfter = parseInt(chunksAfter.rows[0]?.n ?? "0", 10);
  const embedCountAfter = parseInt(embedsAfter.rows[0]?.n ?? "0", 10);

  expect(countAfter).toBe(countBefore);
  expect(embedCountAfter).toBe(embedCountBefore);
}, 300_000);
