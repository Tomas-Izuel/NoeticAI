// One-shot migration runner. Applies any pending SQL migration files to the DB.
// Usage: bun run scripts/migrate.ts
import { pool } from "../src/db";
import { runMigrations } from "@noeticai/db";

await runMigrations(pool);
console.log("Migrations applied.");
await pool.end();
