import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db } from "../db";
import { auth } from "../auth";
import { enqueueIngest } from "../queue";

export const ingestRouter = new Hono();

ingestRouter.post("/dev/ingest", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const body = await c.req.json().catch(() => ({}));
  const source = typeof body?.source === "string" ? body.source : "stub";

  const jobId = await enqueueIngest({ userId: session.user.id, source });
  return c.json({ jobId, queue: "ingest" });
});

ingestRouter.get("/dev/fragments", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const rows = await db.execute<{
    id: string;
    note_id: string;
    title: string;
    position: number;
    kind: string;
    text: string;
    model_id: string | null;
    dim: number | null;
  }>(sql`
    SELECT
      f.id,
      f.note_id,
      n.title,
      f.position,
      f.kind,
      f.text,
      e.model_id,
      e.dim
    FROM ${schema.noteFragments} f
    JOIN ${schema.notes} n ON n.id = f.note_id
    JOIN ${schema.subjects} s ON s.id = n.subject_id
    LEFT JOIN ${schema.noteFragmentEmbeddings} e ON e.fragment_id = f.id
    WHERE s.user_id = ${session.user.id}
    ORDER BY n.title ASC, f.position ASC
  `);

  return c.json({
    fragments: rows.rows.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      noteTitle: r.title,
      position: r.position,
      kind: r.kind,
      text: r.text,
      modelId: r.model_id,
      dim: r.dim,
    })),
  });
});
