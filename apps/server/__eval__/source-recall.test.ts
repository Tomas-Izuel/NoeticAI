/**
 * Phase 4 eval gate (phase4-plan.md §10):
 *
 *   1. Chunk count band: ingest source-fixture.pdf; assert 35 ≤ chunkCount ≤ 75.
 *   2. pages_label spot checks: ≥ 8/10 positions match expected label.
 *   3. Source retrieval recall: ≥ 8/10 queries find expectedSourceTitle in top-3.
 *
 * Requires live infra (Postgres + Redis + Ollama/Bedrock) AND the fixture PDF.
 * Set NOETICAI_EVAL_LIVE=1 to opt in. Without it, this test self-skips.
 * CI runs without NOETICAI_EVAL_LIVE=1 — the skeleton stays green when infra
 * is offline.
 *
 * The fixture PDF (source-fixture.pdf) must be added manually — see README.md
 * in this directory.
 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pool } from "../src/db";
import { embed } from "../src/ai";
import { runSourceIngestJob } from "../src/bibliography/job";

interface RecallFixture {
  _meta: {
    passThreshold: number;
    totalQueries: number;
  };
  queries: Array<{
    q: string;
    expectedSourceTitle: string;
    expectedPagesLabel: string;
  }>;
}

interface SpotcheckFixture {
  _meta: {
    passThreshold: number;
  };
  spotchecks: Array<{
    chunkPosition: number;
    expectedPagesLabel: string;
  }>;
}

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const FIXTURE_PATH = join(import.meta.dir, "source-fixture.pdf");

test("Phase 4 source-ingest: chunk count, pages_label spot checks, retrieval recall", async () => {
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

  // Resolve a subject for this user (or create one).
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

  // Build a deterministic sourceId for the fixture.
  const { createHash } = await import("node:crypto");
  const sourceTitle = "BonJour 1985 — The Structure of Empirical Knowledge";
  const fixtureRelPath = "uploads/sources/eval-fixture.pdf";
  const sourceId = createHash("sha256")
    .update(subjectId + "pdf" + fixtureRelPath)
    .digest("hex")
    .slice(0, 24);

  // Insert the source row if needed.
  await pool.query(
    `INSERT INTO sources (id, subject_id, kind, title, status, source_path, source_filename)
     VALUES ($1, $2, 'pdf', $3, 'uploading', $4, 'source-fixture.pdf')
     ON CONFLICT (id) DO NOTHING`,
    [sourceId, subjectId, sourceTitle, fixtureRelPath],
  );

  // Copy fixture PDF to the expected path.
  const { mkdir, copyFile } = await import("node:fs/promises");
  const { join: pathJoin } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const serverRoot = pathJoin(fileURLToPath(new URL(".", import.meta.url)), "..");
  const destDir = pathJoin(serverRoot, "uploads", "sources");
  await mkdir(destDir, { recursive: true });
  await copyFile(FIXTURE_PATH, pathJoin(destDir, "eval-fixture.pdf"));

  // Ingest.
  const result = await runSourceIngestJob({ sourceId, userId });

  // ------------------------------------------------------------------
  // Assertion 1: chunk count in acceptance band [35, 75].
  // ------------------------------------------------------------------
  const countRows = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM source_chunks WHERE source_id = $1`,
    [sourceId],
  );
  const chunkCount = parseInt(countRows.rows[0]?.n ?? "0", 10);
  console.log(`chunk count = ${chunkCount} (expected 35–75)`);
  expect(chunkCount).toBeGreaterThanOrEqual(35);
  expect(chunkCount).toBeLessThanOrEqual(75);
  expect(result.chunkCount).toBe(chunkCount);

  // ------------------------------------------------------------------
  // Assertion 2: pages_label spot checks (≥ 8/10).
  // ------------------------------------------------------------------
  const spotcheckFixture = JSON.parse(
    readFileSync(join(import.meta.dir, "source-spotchecks.json"), "utf8"),
  ) as SpotcheckFixture;

  let spotHits = 0;
  const spotMisses: string[] = [];

  for (const sc of spotcheckFixture.spotchecks) {
    const row = await pool.query<{ pages_label: string | null }>(
      `SELECT pages_label FROM source_chunks WHERE source_id = $1 AND position = $2`,
      [sourceId, sc.chunkPosition],
    );
    const actual = row.rows[0]?.pages_label ?? null;
    if (actual === sc.expectedPagesLabel) {
      spotHits += 1;
    } else {
      spotMisses.push(
        `position=${sc.chunkPosition}: expected "${sc.expectedPagesLabel}", got "${actual}"`,
      );
    }
  }

  if (spotHits < spotcheckFixture._meta.passThreshold) {
    console.error("pages_label misses:\n  " + spotMisses.join("\n  "));
  }
  expect(spotHits).toBeGreaterThanOrEqual(spotcheckFixture._meta.passThreshold);

  // ------------------------------------------------------------------
  // Assertion 3: retrieval recall — expectedSourceTitle in top-3 for
  // ≥ 8/10 queries.
  // ------------------------------------------------------------------
  const recallFixture = JSON.parse(
    readFileSync(join(import.meta.dir, "source-recall.json"), "utf8"),
  ) as RecallFixture;

  let recallHits = 0;
  const recallMisses: string[] = [];

  for (const q of recallFixture.queries) {
    const embedResult = await embed.embed({
      texts: [q.q],
      inputType: "search_query",
    });
    const queryVec = embedResult.vectors[0]!;
    const literal = `[${queryVec.join(",")}]`;

    const top3 = await pool.query<{ source_title: string }>(
      `SELECT s.title AS source_title
       FROM source_chunk_embeddings e
       JOIN source_chunks sc ON sc.id = e.chunk_id
       JOIN sources s ON s.id = sc.source_id
       WHERE s.subject_id = $1 AND e.model_id = $2
       ORDER BY e.vector <=> $3::vector
       LIMIT 3`,
      [subjectId, embedResult.modelId, literal],
    );

    const titles = top3.rows.map((r) => r.source_title);
    if (titles.includes(q.expectedSourceTitle)) {
      recallHits += 1;
    } else {
      recallMisses.push(
        `q="${q.q}" expected "${q.expectedSourceTitle}" not in top-3 [${titles.join(", ")}]`,
      );
    }
  }

  if (recallHits < recallFixture._meta.passThreshold) {
    console.error("retrieval recall misses:\n  " + recallMisses.join("\n  "));
  }
  expect(recallHits).toBeGreaterThanOrEqual(recallFixture._meta.passThreshold);
}, 300_000);
