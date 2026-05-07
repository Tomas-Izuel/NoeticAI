import { createDb } from "@noeticai/db";
import { env } from "./env";

const created = createDb(env.DATABASE_URL);

export const db = created.db;
export const pool = created.pool;
