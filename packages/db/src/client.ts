import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(connectionString: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
