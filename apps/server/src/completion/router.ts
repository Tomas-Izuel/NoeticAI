import { Hono } from "hono";
import { createHash } from "node:crypto";
import { pool } from "../db";
import { auth } from "../auth";
import { enqueueCompletion } from "../queue";
import { embed } from "../ai";
import { cacheWrap } from "../redis/cache";
import { retrieveChunksForConcept, SIMILARITY_FLOOR } from "./retrieve";
import { loadConceptForUser } from "./concept-loader";

export const completionRouter = new Hono();

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Eligibility types + shared computation helper
// ---------------------------------------------------------------------------

type EligibilityReason = "ok" | "no_sources_loaded" | "no_ready_sources" | "no_related_chunks";

interface EligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  subjectSourcesTotal: number;
  subjectSourcesReady: number;
  candidateChunkCount: number;
  topSimilarity: number | null;
  similarityFloor: number;
  embedModelId: string;
  checkedAt: string;
}

async function computeEligibility(
  conceptId: string,
  subjectId: string,
): Promise<EligibilityResult> {
  const embedModelId = embed.defaultModelId;

  // Count sources for the subject — gives us both the cache key components
  // and the first two short-circuit checks.
  const sourceCountRows = await pool.query<{
    total: string;
    ready: string;
    max_updated_at: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'ready') AS ready,
       COALESCE(MAX(EXTRACT(EPOCH FROM updated_at))::bigint, 0)::text AS max_updated_at
     FROM sources WHERE subject_id = $1`,
    [subjectId],
  );

  const countRow = sourceCountRows.rows[0];
  const total = parseInt(countRow?.total ?? "0", 10);
  const ready = parseInt(countRow?.ready ?? "0", 10);
  const maxUpdatedAt = countRow?.max_updated_at ?? "0";

  const cacheKey = `completionEligibility:v1:${conceptId}:${ready}:${total}:${maxUpdatedAt}:${embedModelId}`;

  return cacheWrap<EligibilityResult>(cacheKey, 300, async () => {
    const checkedAt = new Date().toISOString();

    if (total === 0) {
      return {
        eligible: false,
        reason: "no_sources_loaded",
        subjectSourcesTotal: 0,
        subjectSourcesReady: 0,
        candidateChunkCount: 0,
        topSimilarity: null,
        similarityFloor: SIMILARITY_FLOOR,
        embedModelId,
        checkedAt,
      };
    }

    if (ready === 0) {
      return {
        eligible: false,
        reason: "no_ready_sources",
        subjectSourcesTotal: total,
        subjectSourcesReady: 0,
        candidateChunkCount: 0,
        topSimilarity: null,
        similarityFloor: SIMILARITY_FLOOR,
        embedModelId,
        checkedAt,
      };
    }

    // Sources exist and are ready — run retrieval.
    const { chunks, topSimilarityBelowFloor } = await retrieveChunksForConcept({
      conceptId,
      subjectId,
      modelId: embedModelId,
    });

    if (chunks.length > 0) {
      return {
        eligible: true,
        reason: "ok",
        subjectSourcesTotal: total,
        subjectSourcesReady: ready,
        candidateChunkCount: chunks.length,
        topSimilarity: chunks[0]!.retrievalSimilarity,
        similarityFloor: SIMILARITY_FLOOR,
        embedModelId,
        checkedAt,
      };
    }

    return {
      eligible: false,
      reason: "no_related_chunks",
      subjectSourcesTotal: total,
      subjectSourcesReady: ready,
      candidateChunkCount: 0,
      topSimilarity: topSimilarityBelowFloor,
      similarityFloor: SIMILARITY_FLOOR,
      embedModelId,
      checkedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /api/concepts/:id/completion-eligibility
// Returns eligibility status and diagnostic counts without triggering a job.
// ---------------------------------------------------------------------------

completionRouter.get("/api/concepts/:id/completion-eligibility", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const conceptId = c.req.param("id");

  const concept = await loadConceptForUser(conceptId);
  if (!concept) return c.json({ error: "not found" }, 404);
  if (concept.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  const result = await computeEligibility(conceptId, concept.subject_id);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /api/concepts/:id/complete
// Trigger completion generation. Returns 201 with { completionId, jobId, cached }.
// ---------------------------------------------------------------------------

completionRouter.post("/api/concepts/:id/complete", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const conceptId = c.req.param("id");

  // Ownership chain: concept -> syllabus -> subject -> user.
  const concept = await loadConceptForUser(conceptId);
  if (!concept) return c.json({ error: "not found" }, 404);
  if (concept.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  const subjectId = concept.subject_id;

  // Eligibility gate — reuses the same cache as the GET endpoint.
  const eligibility = await computeEligibility(conceptId, subjectId);
  if (!eligibility.eligible) {
    return c.json({ error: "ineligible", reason: eligibility.reason }, 412);
  }

  // Cache short-circuit: check if a recent valid completion exists.
  // "Cached" = a completion with status IN ('pending','merged_locally','edited')
  // for the latest succeeded audit run of this subject, created within 24h.
  const latestRunRows = await pool.query<{ id: string }>(
    `SELECT id FROM audit_runs
     WHERE subject_id = $1 AND status = 'succeeded'
     ORDER BY finished_at DESC LIMIT 1`,
    [subjectId],
  );
  const latestRunId = latestRunRows.rows[0]?.id ?? null;

  if (latestRunId) {
    const cachedRows = await pool.query<{ id: string }>(
      `SELECT id FROM completions
       WHERE concept_id = $1
         AND audit_run_id = $2
         AND status IN ('pending', 'merged_locally', 'edited')
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT 1`,
      [conceptId, latestRunId],
    );
    const cached = cachedRows.rows[0];
    if (cached) {
      return c.json({ completionId: cached.id, jobId: null, cached: true });
    }
  }

  // Find the open gap for this concept.
  const gapRows = await pool.query<{
    id: string;
    latest_run_id: string;
  }>(
    `SELECT id, latest_run_id FROM gaps
     WHERE concept_id = $1 AND status = 'open'
     LIMIT 1`,
    [conceptId],
  );
  const gap = gapRows.rows[0];
  if (!gap) {
    return c.json({ error: "no gap to complete; concept is not flagged" }, 409);
  }

  const auditRunId = gap.latest_run_id;

  // Pre-allocate completions row.
  const completionId = sha256Hex(gap.id + String(Date.now())).slice(0, 24);
  const modelId = embed.defaultModelId; // snapshot at enqueue time

  await pool.query(
    `INSERT INTO completions (
       id, gap_id, concept_id, audit_run_id, status,
       model_id, embed_model_id, prompt_hash,
       input_tokens, output_tokens,
       cache_read_input_tokens, cache_write_input_tokens
     ) VALUES ($1, $2, $3, $4, 'queued', $5, $5, '', 0, 0, 0, 0)`,
    [completionId, gap.id, conceptId, auditRunId, modelId],
  );

  const jobId = await enqueueCompletion(
    { completionId, conceptId, gapId: gap.id, auditRunId, subjectId },
    {
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  );

  return c.json({ completionId, jobId, cached: false }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/concepts/:id/completions/latest
// Fetch the latest completion (any status) for a concept, with citation detail.
// ---------------------------------------------------------------------------

completionRouter.get("/api/concepts/:id/completions/latest", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const conceptId = c.req.param("id");

  // Ownership chain.
  const concept = await loadConceptForUser(conceptId);
  if (!concept) return c.json({ error: "not found" }, 404);
  if (concept.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Latest completion.
  const completionRows = await pool.query<{
    id: string;
    status: string;
    summary: string | null;
    paragraphs: unknown;
    confidence: string | null;
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_write_input_tokens: number;
    guard_failure_reason: string | null;
    failure_reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, status, summary, paragraphs, confidence,
            model_id, input_tokens, output_tokens,
            cache_read_input_tokens, cache_write_input_tokens,
            guard_failure_reason, failure_reason, created_at
     FROM completions
     WHERE concept_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [conceptId],
  );
  const completion = completionRows.rows[0];

  if (!completion) {
    return c.json({ completion: null, citations: {} });
  }

  // Citations + source detail.
  const citationRows = await pool.query<{
    chunk_id: string;
    paragraph_index: number;
    similarity: string;
    source_id: string;
    source_title: string;
    source_author: string | null;
    source_year: number | null;
    chapter_label: string | null;
    pages_label: string | null;
  }>(
    `SELECT
       ci.chunk_id,
       ci.paragraph_index,
       ci.similarity,
       sc.source_id,
       s.title AS source_title,
       s.author AS source_author,
       s.year AS source_year,
       sc.chapter_label,
       sc.pages_label
     FROM citations ci
     JOIN source_chunks sc ON sc.id = ci.chunk_id
     JOIN sources s ON s.id = sc.source_id
     WHERE ci.completion_id = $1`,
    [completion.id],
  );

  const citations: Record<
    string,
    {
      chunkId: string;
      sourceId: string;
      sourceTitle: string;
      sourceAuthor: string | null;
      sourceYear: number | null;
      chapterLabel: string | null;
      pagesLabel: string | null;
      similarity: number;
      paragraphIndex: number;
    }
  > = {};

  for (const row of citationRows.rows) {
    citations[row.chunk_id] = {
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      sourceAuthor: row.source_author,
      sourceYear: row.source_year,
      chapterLabel: row.chapter_label,
      pagesLabel: row.pages_label,
      similarity: parseFloat(row.similarity),
      paragraphIndex: row.paragraph_index,
    };
  }

  return c.json({
    completion: {
      id: completion.id,
      status: completion.status as
        | "queued"
        | "running"
        | "pending"
        | "merged_locally"
        | "edited"
        | "rejected"
        | "null_no_grounding"
        | "failed",
      summary: completion.summary,
      paragraphs: completion.paragraphs as Array<{ text: string; sourceIds: string[] }> | null,
      confidence: completion.confidence !== null ? parseFloat(completion.confidence) : null,
      modelId: completion.model_id,
      inputTokens: completion.input_tokens,
      outputTokens: completion.output_tokens,
      cacheReadInputTokens: completion.cache_read_input_tokens,
      cacheWriteInputTokens: completion.cache_write_input_tokens,
      guardFailureReason: completion.guard_failure_reason,
      failureReason: completion.failure_reason,
      createdAt: completion.created_at.toISOString(),
    },
    citations,
  });
});

// ---------------------------------------------------------------------------
// GET /api/concepts/:id
// Concept basics: name, LO, syllabus_excerpt, neighborhood, unit, subject,
// and the most-recent succeeded audit run for the parent subject.
// ---------------------------------------------------------------------------

completionRouter.get("/api/concepts/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const conceptId = c.req.param("id");

  // Single JOIN query: concept → syllabus → subject → (optional) unit.
  // Also pulls subject.user_id so we can do the ownership check in one round-trip.
  const rows = await pool.query<{
    concept_id: string;
    concept_name: string;
    learning_objective: string | null;
    syllabus_excerpt: string | null;
    neighborhood: unknown;
    subject_id: string;
    subject_name: string;
    subject_course: string | null;
    unit_id: string | null;
    unit_name: string | null;
    unit_order: number | null;
    unit_weeks_label: string | null;
    user_id: string;
  }>(
    `SELECT
       c.id            AS concept_id,
       c.name          AS concept_name,
       c.learning_objective,
       c.syllabus_excerpt,
       c.neighborhood,
       s.id            AS subject_id,
       s.name          AS subject_name,
       s.course        AS subject_course,
       u.id            AS unit_id,
       u.name          AS unit_name,
       u."order"       AS unit_order,
       u.weeks_label   AS unit_weeks_label,
       s.user_id
     FROM concepts c
     JOIN syllabuses sy ON sy.id = c.syllabus_id
     JOIN subjects s    ON s.id  = sy.subject_id
     LEFT JOIN units u  ON u.id  = c.unit_id
     WHERE c.id = $1`,
    [conceptId],
  );

  const row = rows.rows[0];
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Separate query for the latest succeeded audit run.
  const latestRunRows = await pool.query<{ id: string }>(
    `SELECT id FROM audit_runs
     WHERE subject_id = $1 AND status = 'succeeded'
     ORDER BY finished_at DESC LIMIT 1`,
    [row.subject_id],
  );
  const latestRun = latestRunRows.rows[0] ? { id: latestRunRows.rows[0].id } : null;

  return c.json({
    concept: {
      id: row.concept_id,
      name: row.concept_name,
      learningObjective: row.learning_objective,
      syllabusExcerpt: row.syllabus_excerpt,
      neighborhood: row.neighborhood as string[] | null,
      unit: row.unit_id !== null
        ? {
            id: row.unit_id,
            name: row.unit_name as string,
            order: row.unit_order as number,
            weeksLabel: row.unit_weeks_label,
          }
        : null,
      subject: {
        id: row.subject_id,
        name: row.subject_name,
        course: row.subject_course,
      },
      latestRun,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/sources/:sid/chunks/:chunkId
// Deep-link to a cited passage; includes surrounding chunks for context.
// ---------------------------------------------------------------------------

completionRouter.get("/api/sources/:sid/chunks/:chunkId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const sourceId = c.req.param("sid");
  const chunkId = c.req.param("chunkId");

  // Ownership: source -> subject -> user.
  const sourceRows = await pool.query<{
    id: string;
    title: string;
    author: string | null;
    year: number | null;
    user_id: string;
  }>(
    `SELECT s.id, s.title, s.author, s.year, sub.user_id
     FROM sources s
     JOIN subjects sub ON sub.id = s.subject_id
     WHERE s.id = $1`,
    [sourceId],
  );
  const source = sourceRows.rows[0];
  if (!source) return c.json({ error: "not found" }, 404);
  if (source.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Load the requested chunk and verify it belongs to the given source.
  const chunkRows = await pool.query<{
    id: string;
    source_id: string;
    position: number;
    chapter_label: string | null;
    pages_label: string | null;
    text: string;
    char_count: number;
  }>(
    `SELECT id, source_id, position, chapter_label, pages_label, text, char_count
     FROM source_chunks
     WHERE id = $1 AND source_id = $2`,
    [chunkId, sourceId],
  );
  const chunk = chunkRows.rows[0];
  if (!chunk) return c.json({ error: "not found" }, 404);

  // Load surrounding chunks (position - 1 and position + 1).
  const surroundingRows = await pool.query<{
    id: string;
    position: number;
    text: string;
    pages_label: string | null;
  }>(
    `SELECT id, position, text, pages_label
     FROM source_chunks
     WHERE source_id = $1
       AND position IN ($2, $3)`,
    [sourceId, chunk.position - 1, chunk.position + 1],
  );

  const prevChunk =
    surroundingRows.rows.find((r) => r.position === chunk.position - 1) ?? null;
  const nextChunk =
    surroundingRows.rows.find((r) => r.position === chunk.position + 1) ?? null;

  return c.json({
    chunk: {
      id: chunk.id,
      sourceId: chunk.source_id,
      position: chunk.position,
      chapterLabel: chunk.chapter_label,
      pagesLabel: chunk.pages_label,
      text: chunk.text,
      charCount: chunk.char_count,
    },
    source: {
      id: source.id,
      title: source.title,
      author: source.author,
      year: source.year,
    },
    surrounding: {
      previous: prevChunk
        ? {
            id: prevChunk.id,
            position: prevChunk.position,
            text: prevChunk.text,
            pagesLabel: prevChunk.pages_label,
          }
        : null,
      next: nextChunk
        ? {
            id: nextChunk.id,
            position: nextChunk.position,
            text: nextChunk.text,
            pagesLabel: nextChunk.pages_label,
          }
        : null,
    },
  });
});
