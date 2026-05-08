import { z } from "zod";
import type { ConceptFragmentVerdict } from "@noeticai/audit-core";
import { pool } from "../db";
import { llm, embed } from "../ai";
import { parseLlmJson } from "../ai/json";
import { buildVerdictPrompt } from "./prompt";

export interface AlignmentInput {
  auditRunId: string;
  subjectId: string;
  syllabusId: string;
  modelId: string;             // embed.defaultModelId at run time
  thresholds: {
    amberSimilarity: number;   // 0.55
  };
}

export interface AlignmentCandidate {
  conceptId: string;
  conceptName: string;
  conceptLearningObjective: string | null;
  fragmentId: string;
  fragmentText: string;
  similarity: number;
}

export interface AlignedLink {
  auditRunId: string;
  conceptId: string;
  fragmentId: string;
  similarity: number;
  verdict: ConceptFragmentVerdict;
}

// Zod schema for the Haiku verdict response — array of { id, verdict } items.
const VerdictSchema = z.array(
  z.object({
    id: z.string().min(1),
    verdict: z.enum(["engages", "mentions", "tangential", "off-topic"]),
  }),
);

/**
 * Stage 1: pgvector top-k=20 cosine matches per concept.
 *
 * Both concept_embeddings and note_fragment_embeddings are filtered on the
 * same modelId — the model_id invariant. A console.warn is emitted when
 * either side has zero rows (dev diagnostic; silently empty results otherwise).
 */
export async function fetchAlignmentCandidates(
  input: AlignmentInput,
): Promise<Map<string, AlignmentCandidate[]>> {
  // Dev diagnostic: warn if either side has zero embeddings for this model.
  const [conceptCountRes, fragmentCountRes] = await Promise.all([
    pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM concept_embeddings ce
       JOIN concepts c ON c.id = ce.concept_id
       WHERE c.syllabus_id = $1 AND ce.model_id = $2`,
      [input.syllabusId, input.modelId],
    ),
    pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM note_fragment_embeddings nfe
       JOIN note_fragments nf ON nf.id = nfe.fragment_id
       JOIN notes n ON n.id = nf.note_id
       WHERE n.subject_id = $1 AND nfe.model_id = $2`,
      [input.subjectId, input.modelId],
    ),
  ]);

  const conceptCount = parseInt(conceptCountRes.rows[0]?.cnt ?? "0", 10);
  const fragmentCount = parseInt(fragmentCountRes.rows[0]?.cnt ?? "0", 10);

  if (conceptCount === 0) {
    console.warn(
      `[audit:align] model_id=${input.modelId} — zero concept embeddings for syllabus=${input.syllabusId}. ` +
        `All scores will be red. Ensure concepts were embedded with this model_id.`,
    );
  }
  if (fragmentCount === 0) {
    console.warn(
      `[audit:align] model_id=${input.modelId} — zero fragment embeddings for subject=${input.subjectId}. ` +
        `All scores will be red. Ensure notes were ingested and embedded.`,
    );
  }

  if (conceptCount === 0 || fragmentCount === 0) {
    return new Map();
  }

  // Pre-flight: cross-check that the same model_id has rows on both sides.
  // The previous diagnostic only counts each side; if a stale embed run left
  // concepts under model=A and fragments under model=B, both counts are >0
  // but the cross-join yields zero candidates with a cryptic "candidates=0".
  const modelOverlap = await pool.query<{
    fragment_models: string[];
    concept_models: string[];
  }>(
    `SELECT
       (SELECT array_agg(DISTINCT model_id) FROM (
          SELECT nfe.model_id
          FROM note_fragment_embeddings nfe
          JOIN note_fragments nf ON nf.id = nfe.fragment_id
          JOIN notes n ON n.id = nf.note_id
          WHERE n.subject_id = $1
        ) f) AS fragment_models,
       (SELECT array_agg(DISTINCT model_id) FROM (
          SELECT ce.model_id
          FROM concept_embeddings ce
          JOIN concepts c ON c.id = ce.concept_id
          WHERE c.syllabus_id = $2
        ) c) AS concept_models`,
    [input.subjectId, input.syllabusId],
  );
  const fragMods = modelOverlap.rows[0]?.fragment_models ?? [];
  const concMods = modelOverlap.rows[0]?.concept_models ?? [];
  const overlap = fragMods.filter((m) => concMods.includes(m));
  if (!overlap.includes(input.modelId)) {
    console.warn(
      `[audit:align] model_id mismatch — runtime=${input.modelId} ` +
        `fragment_models=[${fragMods.join(",")}] concept_models=[${concMods.join(",")}]. ` +
        `Re-embed one side under ${input.modelId} or restart with the matching backend.`,
    );
  }

  // Stage 1: cross-join CTE with HNSW-unfriendly but bounded cross-product.
  // Phase 3 sizes: ≤80 concepts × ≤250 fragments = 20K pairs — acceptable.
  const result = await pool.query<{
    concept_id: string;
    concept_name: string;
    learning_objective: string | null;
    fragment_id: string;
    fragment_text: string;
    similarity: string;
  }>(
    `WITH concept_vecs AS (
       SELECT c.id AS concept_id, c.name, c.learning_objective, ce.vector
       FROM concepts c
       JOIN concept_embeddings ce ON ce.concept_id = c.id
       WHERE c.syllabus_id = $1
         AND ce.model_id = $2
     ),
     fragment_vecs AS (
       SELECT
         nf.id AS fragment_id,
         nf.text AS fragment_text,
         nfe.vector
       FROM note_fragments nf
       JOIN notes n ON n.id = nf.note_id
       JOIN note_fragment_embeddings nfe ON nfe.fragment_id = nf.id
       WHERE n.subject_id = $3
         AND nfe.model_id = $2
         AND nf.kind <> 'code'
     ),
     ranked AS (
       SELECT
         cv.concept_id,
         cv.name AS concept_name,
         cv.learning_objective,
         fv.fragment_id,
         fv.fragment_text,
         1 - (cv.vector <=> fv.vector) AS similarity,
         ROW_NUMBER() OVER (
           PARTITION BY cv.concept_id
           ORDER BY cv.vector <=> fv.vector ASC
         ) AS rk
       FROM concept_vecs cv
       CROSS JOIN fragment_vecs fv
     )
     SELECT concept_id, concept_name, learning_objective,
            fragment_id, fragment_text, similarity
     FROM ranked
     WHERE rk <= 20 AND similarity >= $4
     ORDER BY concept_id, similarity DESC`,
    [
      input.syllabusId,
      input.modelId,
      input.subjectId,
      input.thresholds.amberSimilarity,
    ],
  );

  const grouped = new Map<string, AlignmentCandidate[]>();
  for (const row of result.rows) {
    const existing = grouped.get(row.concept_id);
    const candidate: AlignmentCandidate = {
      conceptId: row.concept_id,
      conceptName: row.concept_name,
      conceptLearningObjective: row.learning_objective,
      fragmentId: row.fragment_id,
      fragmentText: row.fragment_text,
      similarity: parseFloat(row.similarity),
    };
    if (existing) {
      existing.push(candidate);
    } else {
      grouped.set(row.concept_id, [candidate]);
    }
  }

  // Diagnostic: if the threshold filter dropped everything, log what the
  // top similarities actually were. Distinguishes "embeddings are bad"
  // (top sim ~0) from "threshold too tight" (top sim ~0.45, threshold 0.55).
  if (grouped.size === 0) {
    const probe = await pool.query<{
      concept_name: string;
      best_similarity: string;
    }>(
      `SELECT
         c.name AS concept_name,
         MAX(1 - (ce.vector <=> nfe.vector)) AS best_similarity
       FROM concepts c
       JOIN concept_embeddings ce ON ce.concept_id = c.id AND ce.model_id = $2
       CROSS JOIN (
         SELECT nfe.vector
         FROM note_fragment_embeddings nfe
         JOIN note_fragments nf ON nf.id = nfe.fragment_id
         JOIN notes n ON n.id = nf.note_id
         WHERE n.subject_id = $3 AND nfe.model_id = $2 AND nf.kind <> 'code'
       ) nfe
       WHERE c.syllabus_id = $1
       GROUP BY c.id, c.name
       ORDER BY best_similarity DESC
       LIMIT 5`,
      [input.syllabusId, input.modelId, input.subjectId],
    );
    const summary = probe.rows
      .map((r) => `${r.concept_name}=${parseFloat(r.best_similarity).toFixed(3)}`)
      .join(", ");
    console.warn(
      `[audit:align] zero candidates passed threshold ${input.thresholds.amberSimilarity}. ` +
        `Top-5 best similarities (any pair): ${summary || "none"}. ` +
        (summary
          ? `If these are well below ${input.thresholds.amberSimilarity}, ` +
            `the syllabus and notes are probably about different topics, ` +
            `or the dev embed model (bge-m3) is producing poor cross-domain similarity.`
          : `No pairs found at all — check that ingest ran for this subject and model_id.`),
    );
  }

  return grouped;
}

/**
 * Stage 2: per concept, batch all candidates into one Haiku verdict call.
 * Concurrency cap = 4 (hand-rolled semaphore — no new dep).
 * Drops verdicts ∈ {"off-topic", "tangential"}; persists only "engages" and
 * "mentions" to concept_fragment_links.
 */
export async function runAlignment(input: AlignmentInput): Promise<{
  candidatesConsidered: number;
  linksPersisted: number;
  haikuCalls: number;
}> {
  const grouped = await fetchAlignmentCandidates(input);

  if (grouped.size === 0) {
    return { candidatesConsidered: 0, linksPersisted: 0, haikuCalls: 0 };
  }

  let candidatesConsidered = 0;
  let linksPersisted = 0;
  let haikuCalls = 0;

  const conceptEntries = Array.from(grouped.entries());
  const CONCURRENCY_CAP = 4;

  // Process concepts in batches of CONCURRENCY_CAP (hand-rolled semaphore).
  for (let i = 0; i < conceptEntries.length; i += CONCURRENCY_CAP) {
    const slice = conceptEntries.slice(i, i + CONCURRENCY_CAP);

    await Promise.all(
      slice.map(async ([conceptId, candidates]) => {
        candidatesConsidered += candidates.length;

        const firstCandidate = candidates[0];
        if (!firstCandidate) return;

        const { system, user } = buildVerdictPrompt({
          conceptName: firstCandidate.conceptName,
          conceptLearningObjective: firstCandidate.conceptLearningObjective,
          candidates: candidates.map((c) => ({
            id: c.fragmentId,
            text: c.fragmentText,
          })),
        });

        const result = await llm.haiku({
          system,
          messages: [{ role: "user", content: [{ text: user }] }],
          maxTokens: 4096,
          temperature: 0,
        });
        haikuCalls += 1;

        // Resilience: if the verdict call returns empty or unparseable JSON
        // (gemma sometimes refuses array-output prompts), don't fail the
        // whole audit — log + skip this concept (treat all candidates as
        // off-topic, so no links are persisted; mastery_score lands red).
        let verdicts: z.infer<typeof VerdictSchema>;
        try {
          if (!result.text || !result.text.trim()) {
            throw new Error(
              `empty response from Haiku ` +
                `(model=${result.modelId}, stop=${result.stopReason ?? "?"}, ` +
                `output_tokens=${result.usage.outputTokens}). ` +
                `On Ollama, gemma occasionally refuses array-output prompts.`,
            );
          }
          verdicts = parseLlmJson(result.text, VerdictSchema);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(
            `[audit:align] verdict batch failed for concept=${conceptId} ` +
              `(${candidates.length} candidates): ${message} — ` +
              `treating as off-topic and continuing.`,
          );
          return;
        }

        // Build a map of fragmentId → similarity from the candidates.
        const candidateMap = new Map(
          candidates.map((c) => [c.fragmentId, c.similarity]),
        );

        // Filter to only valid candidate ids (drop any hallucinated ids).
        const validVerdicts = verdicts.filter((v) =>
          candidateMap.has(v.id),
        );

        // Persist only engages and mentions.
        for (const v of validVerdicts) {
          if (v.verdict !== "engages" && v.verdict !== "mentions") continue;
          const similarity = candidateMap.get(v.id)!;

          await pool.query(
            `INSERT INTO concept_fragment_links
               (audit_run_id, concept_id, fragment_id, similarity, verdict)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (audit_run_id, concept_id, fragment_id) DO NOTHING`,
            [input.auditRunId, conceptId, v.id, similarity, v.verdict],
          );
          linksPersisted += 1;
        }
      }),
    );
  }

  return { candidatesConsidered, linksPersisted, haikuCalls };
}
