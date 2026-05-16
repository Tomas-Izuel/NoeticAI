import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db } from "../db";
import { auth } from "../auth";
import { enqueueIngest } from "../queue";
import { connectorRegistry } from "../connectors/registry";

export const ingestRouter = new Hono();

ingestRouter.post("/dev/ingest", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const body = await c.req.json().catch(() => ({}));
  const source = typeof body?.source === "string" ? body.source : "stub";

  // Stub-only convenience: auto-detect the single subject so `POST /dev/ingest`
  // still works with an empty body. For production sources (notion etc.) the
  // caller must provide subjectExternalId explicitly.
  //
  // PROD-CHANGE NOTE: this auto-detect is a stub-only convenience path. All
  // production ingest entry points (POST /api/subjects/:id/ingest and
  // POST /api/connections/:id/mappings/:mappingId/subjects/sync) always pass an
  // explicit subjectExternalId.
  let subjectExternalId: string | undefined =
    typeof body?.subjectExternalId === "string" ? body.subjectExternalId : undefined;

  if (!subjectExternalId && source === "stub") {
    const connector = connectorRegistry.get("stub");
    if (connector) {
      const subjects = await connector.listSubjects({ userId: session.user.id });
      subjectExternalId = subjects[0]?.id;
    }
  }

  if (!subjectExternalId) {
    return c.json({ error: "subjectExternalId required for non-stub sources" }, 400);
  }

  const jobId = await enqueueIngest({ userId: session.user.id, source, subjectExternalId });
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
