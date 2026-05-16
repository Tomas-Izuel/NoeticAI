import { pool } from "../db";
import { embed } from "../ai";
import { env } from "../env";

export interface RetrievedChunk {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourceYear: number | null;
  position: number;
  chapterLabel: string | null;
  pagesLabel: string | null;
  text: string;
  retrievalSimilarity: number;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  // Best similarity among rows that did NOT pass the floor; null when no rows exist at all.
  topSimilarityBelowFloor: number | null;
}

export interface RetrieveInput {
  conceptId: string;
  subjectId: string;
  modelId: string; // embed model_id (must match source_chunk_embeddings rows)
  k?: number; // default 10
}

const DEFAULT_K = 10;
// Spec floor (plan.md §1.6) is 0.55 on Cohere v3. bge-m3 (Ollama dev backend)
// produces cosines ~0.10–0.20 lower across the board — even relevant chunks
// land at 0.40–0.55 and would be filtered out. Mirrors the
// DEV_OLLAMA_THRESHOLDS pattern in apps/server/src/audit/router.ts. Remove on
// Bedrock cutover (tracked in prod-changes.md Phase 5 dev shortcuts).
export const SIMILARITY_FLOOR =
  env.NOETICAI_AI_BACKEND === "ollama" ? 0.4 : 0.55;
const MAX_CHUNKS_PER_SOURCE = 3;

/**
 * Retrieves the top-k source chunks most relevant to the concept.
 *
 * Steps:
 *  1. Load concept (name, learning_objective, neighborhood) + neighbor names.
 *  2. Compose query text from name + LO + neighbor names.
 *  3. Embed the query text with inputType="search_query".
 *  4. pgvector cosine top-k from source_chunk_embeddings filtered by subjectId
 *     and modelId. Only sources with status='ready' are considered.
 *  5. Apply diversity cap: at most MAX_CHUNKS_PER_SOURCE per source.
 *  6. Run a second query (no floor) to find topSimilarityBelowFloor.
 *  7. Return RetrieveResult.
 *
 * Returns chunks=[] if there are no ready sources or nothing above the similarity floor.
 * topSimilarityBelowFloor is null when no chunks exist at all (not even below floor).
 */
export async function retrieveChunksForConcept(
  input: RetrieveInput,
): Promise<RetrieveResult> {
  const k = input.k ?? DEFAULT_K;

  // 1. Load concept.
  const conceptRows = await pool.query<{
    name: string;
    learning_objective: string | null;
    neighborhood: unknown;
  }>(
    `SELECT name, learning_objective, neighborhood FROM concepts WHERE id = $1`,
    [input.conceptId],
  );
  const concept = conceptRows.rows[0];
  if (!concept) return { chunks: [], topSimilarityBelowFloor: null };

  // 2. Build neighbor names list (neighborhood is a jsonb array of {name: string} or similar).
  let neighborNames: string[] = [];
  if (concept.neighborhood && Array.isArray(concept.neighborhood)) {
    neighborNames = (concept.neighborhood as Array<{ name?: string }>)
      .map((n) => n?.name ?? "")
      .filter((s) => s.length > 0)
      .slice(0, 5);
  }

  const queryText = [
    concept.name,
    concept.learning_objective ?? "",
    neighborNames.join(", "),
  ]
    .filter((s) => s.length > 0)
    .join("\n");

  // 3. Embed — one call; both queries below reuse the same vector.
  const embedResult = await embed.embed({ texts: [queryText], inputType: "search_query" });
  const queryVec = embedResult.vectors[0];
  if (!queryVec) return { chunks: [], topSimilarityBelowFloor: null };

  const literal = `[${queryVec.join(",")}]`;

  // 4. Top-k cosine query with floor filter.
  // We fetch k * MAX_CHUNKS_PER_SOURCE to have enough rows after diversity cap.
  const fetchLimit = k * MAX_CHUNKS_PER_SOURCE;

  const rows = await pool.query<{
    chunk_id: string;
    source_id: string;
    source_title: string;
    source_author: string | null;
    source_year: number | null;
    position: number;
    chapter_label: string | null;
    pages_label: string | null;
    text: string;
    similarity: number;
  }>(
    `SELECT
       sc.id AS chunk_id,
       s.id AS source_id,
       s.title AS source_title,
       s.author AS source_author,
       s.year AS source_year,
       sc.position,
       sc.chapter_label,
       sc.pages_label,
       sc.text,
       (1 - (e.vector <=> $1::vector)) AS similarity
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     JOIN sources s ON s.id = sc.source_id
     WHERE s.subject_id = $2
       AND e.model_id = $3
       AND s.status = 'ready'
       AND (1 - (e.vector <=> $1::vector)) >= $4
     ORDER BY e.vector <=> $1::vector
     LIMIT $5`,
    [literal, input.subjectId, input.modelId, SIMILARITY_FLOOR, fetchLimit],
  );

  // 5. Diversity cap: at most MAX_CHUNKS_PER_SOURCE per source.
  const countBySource = new Map<string, number>();
  const chunks: RetrievedChunk[] = [];

  for (const row of rows.rows) {
    const count = countBySource.get(row.source_id) ?? 0;
    if (count >= MAX_CHUNKS_PER_SOURCE) continue;
    countBySource.set(row.source_id, count + 1);

    chunks.push({
      chunkId: row.chunk_id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      sourceAuthor: row.source_author,
      sourceYear: row.source_year,
      position: row.position,
      chapterLabel: row.chapter_label,
      pagesLabel: row.pages_label,
      text: row.text,
      retrievalSimilarity: typeof row.similarity === "string"
        ? parseFloat(row.similarity)
        : row.similarity,
    });

    if (chunks.length >= k) break;
  }

  // 6. Find the best similarity strictly below the floor (for eligibility hint).
  // Uses the same embed vector — no extra embed call.
  const belowFloorRows = await pool.query<{ similarity: number }>(
    `SELECT (1 - (e.vector <=> $1::vector)) AS similarity
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     JOIN sources s ON s.id = sc.source_id
     WHERE s.subject_id = $2
       AND e.model_id = $3
       AND s.status = 'ready'
       AND (1 - (e.vector <=> $1::vector)) < $4
     ORDER BY e.vector <=> $1::vector ASC
     LIMIT 1`,
    [literal, input.subjectId, input.modelId, SIMILARITY_FLOOR],
  );

  const belowRow = belowFloorRows.rows[0];
  const topSimilarityBelowFloor = belowRow
    ? (typeof belowRow.similarity === "string" ? parseFloat(belowRow.similarity) : belowRow.similarity)
    : null;

  return { chunks, topSimilarityBelowFloor };
}
