import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pool } from "../db";
import { embed } from "../ai";
import { extractPdfPages } from "./extract";
import { fetchUrl } from "./fetch-url";
import { chunkPages, type SourceChunk } from "./chunker";
import { resolveSourcePath } from "./storage";

// ---------------------------------------------------------------------------
// Embed constants — mirror apps/server/src/syllabus/job.ts
// ---------------------------------------------------------------------------
const EMBED_CONCURRENCY = 2;
const EMBED_BATCH_SIZE = 8;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export interface SourceIngestResult {
  sourceId: string;
  chunkCount: number;
  durationMs: number;
}

/**
 * Core ingest pipeline:
 *   1. Load sources row; throw if not found.
 *   2. UPDATE status='chunking'.
 *   3. Extract text (PDF: per-page; URL: fetch+strip).
 *   4. Run chunker → SourceChunk[].
 *   5. Persist source_chunks rows (idempotent ON CONFLICT).
 *   6. Embed all chunks (skip-if-already-embedded, batch+concurrency).
 *   7. UPDATE status='embedded'.
 *   8. UPDATE status='ready' (v1: immediate; v1.1 may insert a verify step).
 *
 * Exported for the eval test harness. Production code uses processSourceIngestJob.
 */
export async function runSourceIngestJob(opts: {
  sourceId: string;
  userId: string;
}): Promise<SourceIngestResult> {
  const startedAt = performance.now();
  const { sourceId } = opts;

  // ------------------------------------------------------------------
  // 1. Load sources row.
  // ------------------------------------------------------------------
  const sourceRows = await pool.query<{
    id: string;
    kind: string;
    source_path: string | null;
    external_url: string | null;
  }>(
    `SELECT id, kind, source_path, external_url FROM sources WHERE id = $1`,
    [sourceId],
  );
  const source = sourceRows.rows[0];
  if (!source) {
    throw new Error(`sourceId=${sourceId} not found`);
  }

  // ------------------------------------------------------------------
  // 2. Mark chunking.
  // ------------------------------------------------------------------
  await pool.query(
    `UPDATE sources SET status = 'chunking', updated_at = NOW() WHERE id = $1`,
    [sourceId],
  );

  // ------------------------------------------------------------------
  // 3. Extract text.
  // ------------------------------------------------------------------
  let chunks: SourceChunk[];
  let pageCount: number | null = null;
  let byteCount: number | null = null;

  if (source.kind === "pdf") {
    if (!source.source_path) {
      throw new Error(`sourceId=${sourceId} has kind=pdf but no source_path`);
    }
    const absolutePath = resolveSourcePath(source.source_path);
    const pdfBytes = await readFile(absolutePath);
    const { pages, pageCount: pc } = await extractPdfPages(new Uint8Array(pdfBytes));
    pageCount = pc;
    byteCount = pdfBytes.length;

    // ------------------------------------------------------------------
    // 4. Chunk.
    // ------------------------------------------------------------------
    chunks = chunkPages(pages, { kind: "pdf" });
  } else if (source.kind === "url") {
    if (!source.external_url) {
      throw new Error(`sourceId=${sourceId} has kind=url but no external_url`);
    }
    const fetched = await fetchUrl(source.external_url);
    byteCount = fetched.byteCount;

    // Store canonical URL back (may differ if redirected).
    await pool.query(
      `UPDATE sources SET external_url = $1, fetched_at = NOW(), byte_count = $2, updated_at = NOW() WHERE id = $3`,
      [fetched.externalUrl, byteCount, sourceId],
    );

    chunks = chunkPages([fetched.text], { kind: "url" });
  } else {
    throw new Error(`sourceId=${sourceId} has unsupported kind=${source.kind}`);
  }

  // Persist page_count + byte_count for PDF sources.
  if (pageCount !== null || byteCount !== null) {
    await pool.query(
      `UPDATE sources SET page_count = COALESCE($1, page_count), byte_count = COALESCE($2, byte_count), updated_at = NOW() WHERE id = $3`,
      [pageCount, byteCount, sourceId],
    );
  }

  // ------------------------------------------------------------------
  // 5. Persist source_chunks rows (idempotent ON CONFLICT DO NOTHING).
  // ------------------------------------------------------------------
  for (const chunk of chunks) {
    const chunkId = sha256Hex(sourceId + String(chunk.position) + chunk.textHash).slice(0, 24);
    await pool.query(
      `INSERT INTO source_chunks (id, source_id, position, chapter_label, pages_label, text, text_hash, char_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        chunkId,
        sourceId,
        chunk.position,
        chunk.chapterLabel,
        chunk.pagesLabel,
        chunk.text,
        chunk.textHash,
        chunk.charCount,
      ],
    );
  }

  // ------------------------------------------------------------------
  // 6. Embed step — mirror apps/server/src/syllabus/job.ts:230-283
  // ------------------------------------------------------------------
  // Reload chunk ids from DB (may already have rows from a prior partial run).
  const chunkIdRows = await pool.query<{ id: string; text: string }>(
    `SELECT id, text FROM source_chunks WHERE source_id = $1 ORDER BY position`,
    [sourceId],
  );
  const chunksToEmbed = chunkIdRows.rows;

  const modelId = embed.defaultModelId;

  const haveEmbeddings = new Set<string>();
  if (chunksToEmbed.length > 0) {
    const existing = await pool.query<{ chunk_id: string }>(
      `SELECT chunk_id FROM source_chunk_embeddings
       WHERE model_id = $1 AND chunk_id = ANY($2::text[])`,
      [modelId, chunksToEmbed.map((c) => c.id)],
    );
    for (const r of existing.rows) haveEmbeddings.add(r.chunk_id);
  }

  const todo = chunksToEmbed.filter((c) => !haveEmbeddings.has(c.id));

  const batches: Array<typeof todo> = [];
  for (let i = 0; i < todo.length; i += EMBED_BATCH_SIZE) {
    batches.push(todo.slice(i, i + EMBED_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
    const slice = batches.slice(i, i + EMBED_CONCURRENCY);
    const results = await Promise.all(
      slice.map((batch) =>
        embed.embed({ texts: batch.map((b) => b.text), inputType: "search_document" }),
      ),
    );
    for (let bi = 0; bi < slice.length; bi += 1) {
      const batch = slice[bi]!;
      const embedResult = results[bi]!;
      if (embedResult.dim !== 1024) {
        throw new Error(`embed returned dim=${embedResult.dim}, expected 1024`);
      }
      for (let vi = 0; vi < batch.length; vi += 1) {
        const item = batch[vi]!;
        const vec = embedResult.vectors[vi]!;
        await pool.query(
          `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector)
           VALUES ($1, $2, $3, $4::vector)
           ON CONFLICT (chunk_id, model_id) DO NOTHING`,
          [item.id, modelId, embedResult.dim, `[${vec.join(",")}]`],
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Mark embedded.
  // ------------------------------------------------------------------
  await pool.query(
    `UPDATE sources SET status = 'embedded', updated_at = NOW() WHERE id = $1`,
    [sourceId],
  );

  // ------------------------------------------------------------------
  // 8. Immediately mark ready (v1: no verification step between embedded→ready).
  // ------------------------------------------------------------------
  await pool.query(
    `UPDATE sources SET status = 'ready', updated_at = NOW() WHERE id = $1`,
    [sourceId],
  );

  return {
    sourceId,
    chunkCount: chunks.length,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Top-level BullMQ job handler: wraps runSourceIngestJob and persists
 * failure_reason before re-throwing so BullMQ marks the job as failed.
 * Mirrors processSyllabusJob in apps/server/src/syllabus/job.ts:306.
 */
export async function processSourceIngestJob(opts: {
  sourceId: string;
  userId: string;
}): Promise<SourceIngestResult> {
  try {
    return await runSourceIngestJob(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort DB write — don't let a secondary failure obscure the original.
    try {
      await pool.query(
        `UPDATE sources SET status = 'failed', failure_reason = $1, updated_at = NOW() WHERE id = $2`,
        [message, opts.sourceId],
      );
    } catch {
      // ignore secondary failure
    }
    throw err;
  }
}
