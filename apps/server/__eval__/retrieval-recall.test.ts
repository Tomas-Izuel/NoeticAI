/**
 * Phase 1 eval gate (implementation.md §"Phase 1 / Validation gate"):
 *   - top-1 retrieval matches expected fragment on ≥ 8/10 seeded queries
 *   - every embedding row has dim=1024 and model_id is consistent
 *   - rerunning ingest with unchanged fragments adds zero embeddings
 *
 * Requires live infra: Postgres + Redis + Bedrock. Set NOETICAI_HEALTH_SKIP_BEDROCK=0
 * before running. CI uses NOETICAI_EVAL_LIVE=1 to opt in; without that env, this
 * test self-skips so the bun test eval skeleton stays green when infra is offline.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db, pool } from "../src/db";
import { embed } from "../src/ai";
import { runIngest } from "../src/ingest/pipeline";
import { connectorRegistry } from "../src/connectors/registry";
import { env } from "../src/env";

interface Fixture {
  _meta: {
    passThreshold: number;
    totalQueries: number;
    embedModel: string;
  };
  queries: Array<{
    q: string;
    expectedExternalId: string;
    expectedPosition: number;
  }>;
}

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";

test("Phase 1 retrieval recall ≥ 8/10 + invariants", async () => {
  if (!LIVE) {
    // eslint-disable-next-line no-console
    console.log("skipping live eval — set NOETICAI_EVAL_LIVE=1 to run");
    return;
  }

  // Resolve a real user_id from the auth table. The eval expects at least
  // one user has signed up; if none exists, we fail loudly.
  const userRow = await pool.query<{ id: string }>(
    `SELECT id FROM "user" ORDER BY created_at ASC LIMIT 1`,
  );
  const userId = userRow.rows[0]?.id;
  if (!userId) {
    throw new Error("no users found — sign up via the web UI first");
  }

  // Resolve the stub's single subject id for this user.
  const stubConnector = connectorRegistry.get("stub")!;
  const stubSubjects = await stubConnector.listSubjects({ userId });
  const subjectExternalId = stubSubjects[0]!.id;

  // First run — populates everything.
  const first = await runIngest({ userId, source: "stub", subjectExternalId });
  expect(first.notesIngested).toBeGreaterThan(0);
  expect(first.modelId).toBe(env.NOETICAI_BEDROCK_EMBED_ID);

  // Second run — fragments are unchanged, so no new embeddings should write.
  const second = await runIngest({ userId, source: "stub", subjectExternalId });
  expect(second.fragmentsAdded).toBe(0);
  expect(second.embeddingsAdded).toBe(0);

  // Invariant: every embedding has dim=1024 and the same model_id.
  const inv = await db.execute<{ dim: number; model_id: string; n: number }>(sql`
    SELECT dim, model_id, COUNT(*)::int AS n
    FROM ${schema.noteFragmentEmbeddings}
    GROUP BY dim, model_id
  `);
  expect(inv.rows.length).toBe(1);
  expect(inv.rows[0]!.dim).toBe(1024);
  expect(inv.rows[0]!.model_id).toBe(env.NOETICAI_BEDROCK_EMBED_ID);

  // Recall: top-1 match per query.
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, "retrieval-recall.json"), "utf8"),
  ) as Fixture;

  let hits = 0;
  const misses: string[] = [];
  for (const q of fixture.queries) {
    const result = await embed.embed({
      texts: [q.q],
      modelId: env.NOETICAI_BEDROCK_EMBED_ID,
      inputType: "search_query",
    });
    const queryVec = result.vectors[0]!;
    const literal = `[${queryVec.join(",")}]`;

    const top = await pool.query<{ external_id: string; position: number; similarity: number }>(
      `SELECT n.external_id, f.position, 1 - (e.vector <=> $1::vector) AS similarity
       FROM note_fragment_embeddings e
       JOIN note_fragments f ON f.id = e.fragment_id
       JOIN notes n ON n.id = f.note_id
       JOIN subjects s ON s.id = n.subject_id
       WHERE s.user_id = $2 AND e.model_id = $3
       ORDER BY e.vector <=> $1::vector
       LIMIT 1`,
      [literal, userId, env.NOETICAI_BEDROCK_EMBED_ID],
    );
    const winner = top.rows[0];
    if (winner && winner.external_id === q.expectedExternalId) {
      hits += 1;
    } else {
      misses.push(
        `q="${q.q}" expected ${q.expectedExternalId} got ${winner?.external_id ?? "none"}`,
      );
    }
  }

  if (hits < fixture._meta.passThreshold) {
    // eslint-disable-next-line no-console
    console.error("misses:\n  " + misses.join("\n  "));
  }
  expect(hits).toBeGreaterThanOrEqual(fixture._meta.passThreshold);
}, 120_000);
