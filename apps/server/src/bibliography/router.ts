import { Hono } from "hono";
import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";
import { embed } from "../ai";
import { storeSourcePdf, resolveSourcePath } from "./storage";
import { enqueueSourceIngest } from "../queue";

export const bibliographyRouter = new Hono();

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB (PDFs are bigger than syllabuses)

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Ownership helper: verify the subject belongs to the authenticated user.
// ---------------------------------------------------------------------------
async function assertSubjectOwner(
  subjectId: string,
  userId: string,
): Promise<void> {
  const rows = await pool.query<{ id: string }>(
    `SELECT id FROM subjects WHERE id = $1 AND user_id = $2`,
    [subjectId, userId],
  );
  if (!rows.rows[0]) {
    throw Object.assign(new Error("subject not found or forbidden"), {
      httpStatus: 404,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/sources — single endpoint, content-type discrimination
// ---------------------------------------------------------------------------

const AddUrlBodySchema = z.object({
  subjectId: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional(),
});

bibliographyRouter.post("/api/sources", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const ct = c.req.header("content-type") ?? "";

  if (ct.startsWith("multipart/form-data")) {
    // PDF path.
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "expected multipart/form-data" }, 400);
    }

    const subjectIdField = formData.get("subjectId");
    if (typeof subjectIdField !== "string" || subjectIdField.trim().length === 0) {
      return c.json({ error: "missing subjectId" }, 400);
    }
    const subjectId = subjectIdField.trim();

    const fileField = formData.get("file");
    if (!(fileField instanceof File)) {
      return c.json({ error: "missing file field" }, 400);
    }
    if (fileField.type !== "application/pdf") {
      return c.json({ error: "file must be application/pdf" }, 400);
    }

    const rawBytes = new Uint8Array(await fileField.arrayBuffer());
    if (rawBytes.length > MAX_PDF_BYTES) {
      return c.json({ error: "file exceeds 25 MB limit" }, 400);
    }

    // Ownership check.
    try {
      await assertSubjectOwner(subjectId, userId);
    } catch {
      return c.json({ error: "subject not found or forbidden" }, 404);
    }

    const titleField = formData.get("title");
    const title =
      typeof titleField === "string" && titleField.trim().length > 0
        ? titleField.trim()
        : fileField.name.replace(/\.pdf$/i, "");

    const stored = await storeSourcePdf({ bytes: rawBytes, originalFilename: fileField.name });

    // Content-addressed id: sha256(subjectId + 'pdf' + relativePath).slice(0, 24).
    const sourceId = sha256Hex(subjectId + "pdf" + stored.relativePath).slice(0, 24);

    await pool.query(
      `INSERT INTO sources (id, subject_id, kind, title, status, source_path, source_filename)
       VALUES ($1, $2, 'pdf', $3, 'uploading', $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [sourceId, subjectId, title, stored.relativePath, stored.filename],
    );

    const jobId = await enqueueSourceIngest({ sourceId, userId }, { attempts: 1 });

    return c.json({ sourceId, jobId }, 201);
  } else if (ct.includes("application/json")) {
    // URL path.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const parsed = AddUrlBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
    }
    const { subjectId, url, title } = parsed.data;

    // Basic URL validation (must be http or https).
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return c.json({ error: "invalid URL" }, 400);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return c.json({ error: "URL must use http or https" }, 400);
    }

    // Ownership check.
    try {
      await assertSubjectOwner(subjectId, userId);
    } catch {
      return c.json({ error: "subject not found or forbidden" }, 404);
    }

    const resolvedTitle = title?.trim() || parsedUrl.hostname;

    // Content-addressed id: sha256(subjectId + 'url' + url).slice(0, 24).
    const sourceId = sha256Hex(subjectId + "url" + url).slice(0, 24);

    await pool.query(
      `INSERT INTO sources (id, subject_id, kind, title, status, external_url)
       VALUES ($1, $2, 'url', $3, 'uploading', $4)
       ON CONFLICT (id) DO NOTHING`,
      [sourceId, subjectId, resolvedTitle, url],
    );

    const jobId = await enqueueSourceIngest({ sourceId, userId }, { attempts: 1 });

    return c.json({ sourceId, jobId }, 201);
  } else {
    return c.json({ error: "expected multipart/form-data or application/json" }, 400);
  }
});

// ---------------------------------------------------------------------------
// GET /api/sources?subjectId=… — list
// ---------------------------------------------------------------------------

bibliographyRouter.get("/api/sources", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const subjectId = c.req.query("subjectId");
  if (!subjectId) return c.json({ error: "subjectId required" }, 400);

  // Ownership check.
  const ownerRows = await pool.query<{ id: string }>(
    `SELECT id FROM subjects WHERE id = $1 AND user_id = $2`,
    [subjectId, userId],
  );
  if (!ownerRows.rows[0]) return c.json({ error: "subject not found or forbidden" }, 404);

  const rows = await pool.query<{
    id: string;
    kind: string;
    title: string;
    author: string | null;
    year: number | null;
    status: string;
    external_url: string | null;
    source_filename: string | null;
    page_count: number | null;
    chunk_count: string; // COUNT returns string in pg-node
    failure_reason: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       s.id,
       s.kind,
       s.title,
       s.author,
       s.year,
       s.status,
       s.external_url,
       s.source_filename,
       s.page_count,
       COUNT(sc.id)::text AS chunk_count,
       s.failure_reason,
       s.created_at,
       s.updated_at
     FROM sources s
     LEFT JOIN source_chunks sc ON sc.source_id = s.id
     WHERE s.subject_id = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
    [subjectId],
  );

  return c.json({
    sources: rows.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      author: r.author,
      year: r.year,
      status: r.status,
      externalUrl: r.external_url,
      sourceFilename: r.source_filename,
      pageCount: r.page_count,
      chunkCount: parseInt(r.chunk_count, 10),
      failureReason: r.failure_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/sources/:id — detail (source + first 50 chunk previews)
// ---------------------------------------------------------------------------

bibliographyRouter.get("/api/sources/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const sourceId = c.req.param("id");

  const sourceRows = await pool.query<{
    id: string;
    subject_id: string;
    kind: string;
    title: string;
    author: string | null;
    year: number | null;
    status: string;
    external_url: string | null;
    source_filename: string | null;
    page_count: number | null;
    byte_count: number | null;
    failure_reason: string | null;
    created_at: Date;
    updated_at: Date;
    user_id: string;
  }>(
    `SELECT s.*, sub.user_id
     FROM sources s
     JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.id = $1`,
    [sourceId],
  );
  const source = sourceRows.rows[0];
  if (!source) return c.json({ error: "not found" }, 404);
  if (source.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Total chunk count.
  const countRows = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM source_chunks WHERE source_id = $1`,
    [sourceId],
  );
  const totalChunks = parseInt(countRows.rows[0]?.n ?? "0", 10);

  // First 50 chunks (preview only — truncate text server-side).
  const chunkRows = await pool.query<{
    position: number;
    chapter_label: string | null;
    pages_label: string | null;
    text: string;
    char_count: number;
  }>(
    `SELECT position, chapter_label, pages_label, text, char_count
     FROM source_chunks
     WHERE source_id = $1
     ORDER BY position
     LIMIT 50`,
    [sourceId],
  );

  return c.json({
    source: {
      id: source.id,
      kind: source.kind,
      title: source.title,
      author: source.author,
      year: source.year,
      status: source.status,
      externalUrl: source.external_url,
      sourceFilename: source.source_filename,
      pageCount: source.page_count,
      chunkCount: totalChunks,
      failureReason: source.failure_reason,
      createdAt: source.created_at,
      updatedAt: source.updated_at,
    },
    chunks: chunkRows.rows.map((r) => ({
      position: r.position,
      chapterLabel: r.chapter_label,
      pagesLabel: r.pages_label,
      textPreview: r.text.slice(0, 240),
      charCount: r.char_count,
    })),
    totalChunks,
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/sources/:id
// ---------------------------------------------------------------------------

bibliographyRouter.delete("/api/sources/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const sourceId = c.req.param("id");

  // Load source + ownership.
  const sourceRows = await pool.query<{
    id: string;
    source_path: string | null;
    user_id: string;
  }>(
    `SELECT s.id, s.source_path, sub.user_id
     FROM sources s
     JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.id = $1`,
    [sourceId],
  );
  const source = sourceRows.rows[0];
  if (!source) return c.json({ error: "not found" }, 404);
  if (source.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Delete row (cascades to source_chunks + source_chunk_embeddings via FK).
  await pool.query(`DELETE FROM sources WHERE id = $1`, [sourceId]);

  // Best-effort: remove on-disk PDF.
  if (source.source_path) {
    try {
      const absolutePath = resolveSourcePath(source.source_path);
      await unlink(absolutePath);
    } catch {
      // leftover file is a janitor problem, not a correctness problem
    }
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/sources/:id/reindex
// ---------------------------------------------------------------------------

bibliographyRouter.post("/api/sources/:id/reindex", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const sourceId = c.req.param("id");

  // Load source + ownership.
  const sourceRows = await pool.query<{
    id: string;
    user_id: string;
  }>(
    `SELECT s.id, sub.user_id
     FROM sources s
     JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.id = $1`,
    [sourceId],
  );
  const source = sourceRows.rows[0];
  if (!source) return c.json({ error: "not found" }, 404);
  if (source.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Delete all chunks (cascades to embeddings).
  await pool.query(`DELETE FROM source_chunks WHERE source_id = $1`, [sourceId]);

  // Reset status.
  await pool.query(
    `UPDATE sources SET status = 'uploading', failure_reason = NULL, updated_at = NOW() WHERE id = $1`,
    [sourceId],
  );

  const jobId = await enqueueSourceIngest({ sourceId, userId }, { attempts: 1 });

  return c.json({ sourceId, jobId }, 200);
});

// ---------------------------------------------------------------------------
// GET /dev/retrieve-source?q=…&subjectId=…&k=…
// ---------------------------------------------------------------------------

bibliographyRouter.get("/dev/retrieve-source", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const q = c.req.query("q")?.trim();
  const subjectId = c.req.query("subjectId");
  if (!q) return c.json({ error: "missing q" }, 400);
  if (!subjectId) return c.json({ error: "missing subjectId" }, 400);
  const k = Math.min(Number(c.req.query("k") ?? 5), 20);

  // Ownership check on subject.
  const ownerRows = await pool.query<{ id: string }>(
    `SELECT id FROM subjects WHERE id = $1 AND user_id = $2`,
    [subjectId, userId],
  );
  if (!ownerRows.rows[0]) return c.json({ error: "subject not found or forbidden" }, 404);

  const result = await embed.embed({ texts: [q], inputType: "search_query" });
  const queryVec = result.vectors[0];
  if (!queryVec) return c.json({ error: "embed returned no vector" }, 500);
  const literal = `[${queryVec.join(",")}]`;

  const rows = await pool.query<{
    id: string;
    source_id: string;
    source_title: string;
    position: number;
    pages_label: string | null;
    text: string;
    distance: number;
  }>(
    `SELECT
       sc.id,
       sc.source_id,
       s.title AS source_title,
       sc.position,
       sc.pages_label,
       sc.text,
       (e.vector <=> $1::vector) AS distance
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     JOIN sources s ON s.id = sc.source_id
     WHERE s.subject_id = $2 AND e.model_id = $3
     ORDER BY e.vector <=> $1::vector
     LIMIT $4`,
    [literal, subjectId, result.modelId, k],
  );

  return c.json({
    query: q,
    modelId: result.modelId,
    results: rows.rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      position: r.position,
      pagesLabel: r.pages_label,
      text: r.text,
      similarity: 1 - r.distance,
      distance: r.distance,
    })),
  });
});
