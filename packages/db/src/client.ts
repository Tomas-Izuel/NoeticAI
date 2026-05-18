import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

function resolveSsl(): pg.PoolConfig["ssl"] {
  const caPath = process.env.PGSSLROOTCERT;
  if (caPath) {
    return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }
  return false;
}

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString, ssl: resolveSsl() });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
