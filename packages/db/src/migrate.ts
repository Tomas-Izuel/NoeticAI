import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

// Tiny SQL migration runner. We hand-roll migrations (drizzle-kit doesn't
// generate vector / HNSW DDL) and apply them in lex order, tracking applied
// names in `_migrations`. Idempotent: re-running is a no-op once everything
// has applied.

const MIGRATIONS_DIR = (() => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // src/migrate.ts (dev) and dist/migrate.js (built) both sit one dir below
  // the package root; migrations/ lives at the package root.
  return join(here, "..", "migrations");
})();

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set<string>(
    (await pool.query<{ name: string }>(`SELECT name FROM _migrations`)).rows.map(
      (r) => r.name,
    ),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      // eslint-disable-next-line no-console
      console.log(`[db] applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
}
