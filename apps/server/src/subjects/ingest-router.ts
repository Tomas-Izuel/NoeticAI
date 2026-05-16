import { Hono } from "hono";
import { auth } from "../auth";
import { pool } from "../db";
import { enqueueIngest } from "../queue";
import { getActiveConnection } from "../connectors/service";

export const ingestSubjectRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /api/subjects/:id/ingest
//
// Triggers a connector ingest run for a specific subject. The subject id IS
// the connector's external id (per the convention in ingest/pipeline.ts).
//
// Determines the source from the subject's active connection. Falls back to
// "stub" if the subject was created via the stub connector.
//
// This is the production ingest trigger. The /dev/ingest route is preserved
// for backward compatibility and direct source selection.
// ---------------------------------------------------------------------------

ingestSubjectRouter.post("/api/subjects/:id/ingest", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const subjectId = c.req.param("id");

  // Ownership check.
  const rows = await pool.query<{ id: string; source_type: string | null }>(
    `SELECT s.id, n.source_type
     FROM subjects s
     LEFT JOIN LATERAL (
       SELECT source_type FROM notes WHERE subject_id = s.id LIMIT 1
     ) n ON TRUE
     WHERE s.id = $1 AND s.user_id = $2`,
    [subjectId, userId],
  );
  const subject = rows.rows[0];
  if (!subject) return c.json({ error: "subject not found or forbidden" }, 404);

  // Determine source from active Notion connection, then from existing notes,
  // then fall back to "stub".
  let source = "stub";

  const activeConn = await getActiveConnection(userId, "notion");
  if (activeConn) {
    source = "notion";
  } else if (subject.source_type) {
    source = subject.source_type;
  }

  // The subject id IS the external id — pass it directly as subjectExternalId.
  const jobId = await enqueueIngest({ userId, source, subjectExternalId: subjectId });
  return c.json({ jobId, source, queue: "ingest" });
});
