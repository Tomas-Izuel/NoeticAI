// Dev reset: nukes all NoeticAI state from orbit. Run with `pnpm reset` (root)
// or `pnpm --filter @noeticai/server reset`.
//
// IMPORTANT: stop the dev server before running this. A live server holds
// BullMQ connections that re-push pending jobs into Redis right after FLUSHDB,
// and Postgres connections that race with the schema rebuild.
//
// What it does:
//   1. DROP SCHEMA public CASCADE; CREATE SCHEMA public — removes every table,
//      index, sequence, constraint, and the _migrations bookkeeping row.
//   2. Re-runs every migration in packages/db/migrations/ via runMigrations().
//      You're back to an empty, freshly-migrated DB.
//   3. FLUSHALL on Redis — clears every BullMQ queue across every db index,
//      plus any cached data, on every connected client.
//   4. rm -rf apps/server/uploads/ — drops uploaded syllabus PDFs.
//
// Flags:
//   --yes        skip the confirmation prompt
//   --keep-files preserve apps/server/uploads/

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import IORedis from "ioredis";
import { runMigrations } from "@noeticai/db";
import { env } from "../src/env";

const args = new Set(process.argv.slice(2));
const skipConfirm = args.has("--yes") || args.has("-y");
const keepFiles = args.has("--keep-files");

const SERVER_ROOT = (() => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..");
})();

function confirm(): boolean {
  if (skipConfirm) return true;
  console.log(
    `\nAbout to NUKE all NoeticAI state.\n` +
      `   db:         ${env.DATABASE_URL}  (DROP SCHEMA public CASCADE)\n` +
      `   redis:      ${env.REDIS_URL}     (FLUSHALL)\n` +
      `   files:      apps/server/uploads/ ${keepFiles ? "(kept)" : "(removed)"}\n\n` +
      `Make sure the dev server is STOPPED.\n`,
  );
  const answer = prompt("Type 'nuke' to proceed:");
  return answer?.trim() === "nuke";
}

async function activeConnections(pool: Pool): Promise<number> {
  const url = new URL(env.DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  const res = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  return parseInt(res.rows[0]?.cnt ?? "0", 10);
}

async function resetDb(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const conns = await activeConnections(pool);
    if (conns > 0) {
      console.warn(
        `[reset:db] WARNING: ${conns} other connection(s) still hold sessions to this DB. ` +
          `If you see migration errors below, stop the dev server and re-run.`,
      );
    }

    console.log(`[reset:db] DROP SCHEMA public CASCADE`);
    await pool.query(`DROP SCHEMA public CASCADE`);
    await pool.query(`CREATE SCHEMA public`);
    // Re-grant default privileges on the public schema (Postgres 15+ revokes
    // CREATE from PUBLIC by default; recreating the schema as the connecting
    // role keeps it owned by us, but be explicit).
    await pool.query(`GRANT ALL ON SCHEMA public TO PUBLIC`);

    console.log(`[reset:db] re-running migrations`);
    await runMigrations(pool);
    console.log(`[reset:db] done`);
  } finally {
    await pool.end();
  }
}

async function resetRedis(): Promise<void> {
  const redis = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  try {
    console.log(`[reset:redis] FLUSHALL`);
    await redis.flushall();
    console.log(`[reset:redis] done`);
  } finally {
    redis.disconnect();
  }
}

async function resetFiles(): Promise<void> {
  if (keepFiles) {
    console.log(`[reset:files] skipped (--keep-files)`);
    return;
  }
  const uploadsDir = join(SERVER_ROOT, "uploads");
  console.log(`[reset:files] rm -rf ${uploadsDir}`);
  await rm(uploadsDir, { recursive: true, force: true });
  console.log(`[reset:files] done`);
}

async function main(): Promise<void> {
  if (!confirm()) {
    console.log("aborted.");
    process.exit(1);
  }

  // DB rebuild and Redis flush are independent — run in parallel.
  await Promise.all([resetDb(), resetRedis()]);
  await resetFiles();

  console.log(
    `\nreset complete. schema is empty, redis is flushed.\n` +
      `start the server (\`pnpm dev:server\`), sign up at /auth/sign-up, then:\n` +
      `  1. upload a syllabus at /onboarding (or POST /api/syllabus)\n` +
      `  2. POST /dev/ingest to load the stub fixtures\n` +
      `  3. run an audit at /audit/<subjectId>\n`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[reset] failed:", err);
  process.exit(1);
});
