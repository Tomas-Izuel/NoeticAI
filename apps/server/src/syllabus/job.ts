import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db, pool } from "../db";
import { llm, embed } from "../ai";
import { parseLlmJson } from "../ai/json";
import { extractPdfText } from "./extract";
import { buildExtractionPrompt } from "./prompt";

// Resolve server root so we can build absolute paths to stored PDFs.
const SERVER_ROOT = (() => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..", "..");
})();

// ---------------------------------------------------------------------------
// Zod validation schema for the LLM response
// ---------------------------------------------------------------------------

const ExtractedConceptSchema = z.object({
  order: z.number().int().positive(),
  name: z.string().min(1),
  learningObjective: z.string().optional(),
  syllabusExcerpt: z.string().optional(),
});

const ExtractedUnitSchema = z.object({
  order: z.number().int().positive(),
  name: z.string().min(1),
  weeksLabel: z.string().optional(),
  concepts: z.array(ExtractedConceptSchema),
});

const ExtractedSubjectSchema = z.object({
  name: z.string(),
  course: z.string().optional(),
  term: z.string().optional(),
});

const ExtractedSyllabusSchema = z.object({
  subject: ExtractedSubjectSchema,
  units: z.array(ExtractedUnitSchema),
});

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic unit id: sha256(syllabusId + ":u" + order).slice(0, 24). */
function makeUnitId(syllabusId: string, order: number): string {
  return sha256Hex(`${syllabusId}:u${order}`).slice(0, 24);
}

// ---------------------------------------------------------------------------
// Embed constants (same as pipeline.ts)
// ---------------------------------------------------------------------------

const EMBED_CONCURRENCY = 2;
const EMBED_BATCH_SIZE = 8;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface SyllabusExtractionResult {
  syllabusId: string;
  subjectId: string;
  conceptCount: number;
  durationMs: number;
}

export async function runSyllabusExtraction(opts: {
  syllabusId: string;
  userId: string;
}): Promise<SyllabusExtractionResult> {
  const startedAt = performance.now();
  const { syllabusId, userId } = opts;

  // ------------------------------------------------------------------
  // 1. Load the syllabuses row to get the stored PDF path and subject.
  // ------------------------------------------------------------------
  const syllabusRows = await db.execute<{
    source_path: string;
    source_filename: string;
    subject_id: string;
  }>(sql`
    SELECT source_path, source_filename, subject_id
    FROM ${schema.syllabuses}
    WHERE id = ${syllabusId}
  `);

  const syllabusRow = syllabusRows.rows[0];
  if (!syllabusRow) {
    throw new Error(`syllabusId=${syllabusId} not found`);
  }
  const {
    source_path: sourcePath,
    source_filename: sourceFilename,
    subject_id: sId,
  } = syllabusRow;

  // ------------------------------------------------------------------
  // 2. Read PDF bytes + extract text.
  // ------------------------------------------------------------------
  const absolutePath = join(SERVER_ROOT, sourcePath);
  const pdfBytes = await readFile(absolutePath);
  const { text: pdfText, pageCount } = await extractPdfText(
    new Uint8Array(pdfBytes),
  );

  // ------------------------------------------------------------------
  // 3. Update status to 'extracting' and persist page count.
  // ------------------------------------------------------------------
  await db.execute(sql`
    UPDATE ${schema.syllabuses}
    SET status = 'extracting', page_count = ${pageCount}
    WHERE id = ${syllabusId}
  `);

  // ------------------------------------------------------------------
  // 4. Call Opus with the extraction prompt.
  // ------------------------------------------------------------------
  const { system, user: userPrompt } = buildExtractionPrompt({
    text: pdfText,
    filename: sourceFilename,
  });

  // 32K output cap — gemma's full output budget. Bedrock Opus emits much
  // tighter JSON (~2K tokens per syllabus per plan.md §4.5); drop this
  // back to 8192 in production. Tracked in prod-changes.md.
  const result = await llm.opus({
    system,
    messages: [{ role: "user", content: [{ text: userPrompt }] }],
    maxTokens: 32768,
    temperature: 0,
  });

  // ------------------------------------------------------------------
  // 5. Parse + validate.
  // ------------------------------------------------------------------
  const extracted = parseLlmJson(result.text, ExtractedSyllabusSchema);

  // ------------------------------------------------------------------
  // 6. Upsert units under the existing subject; attach concepts.
  //
  // The subject row is the source of truth (created via the Notion
  // connect wizard). We do NOT mutate subjects.name / course / term —
  // the extracted metadata is informational only.
  //
  // Unit match strategy (case-insensitive name):
  //   - If an existing unit for this subject matches the extracted name,
  //     reuse its id so Notion-derived units are preserved.
  //   - Otherwise create a new unit with a deterministic id derived from
  //     (syllabusId, order) so reruns are idempotent.
  // ------------------------------------------------------------------

  // Load existing units for this subject (for name-based reuse).
  const existingUnitRows = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM ${schema.units} WHERE subject_id = ${sId}
  `);
  const existingUnits = existingUnitRows.rows;

  // Map extracted order → resolved unit id.
  const unitIdByOrder = new Map<number, string>();

  for (const u of extracted.units) {
    // Case-insensitive name match against existing units for this subject.
    const match = existingUnits.find(
      (eu) => eu.name.toLowerCase() === u.name.toLowerCase(),
    );

    let uId: string;
    if (match) {
      uId = match.id;
      // Update order and weeks_label to reflect syllabus, but leave name
      // as-is (Notion name is source of truth; user may have edited it).
      await db.execute(sql`
        UPDATE ${schema.units}
        SET "order" = ${u.order}, weeks_label = ${u.weeksLabel ?? null}
        WHERE id = ${uId}
      `);
    } else {
      // New unit not previously tracked — create it deterministically.
      uId = makeUnitId(syllabusId, u.order);
      await db.execute(sql`
        INSERT INTO ${schema.units} (id, subject_id, "order", name, weeks_label)
        VALUES (${uId}, ${sId}, ${u.order}, ${u.name}, ${u.weeksLabel ?? null})
        ON CONFLICT (id) DO UPDATE SET
          name        = EXCLUDED.name,
          "order"     = EXCLUDED."order",
          weeks_label = EXCLUDED.weeks_label
      `);
    }

    unitIdByOrder.set(u.order, uId);
  }

  // Concepts: id = `${syllabusId}:c${unitOrder}.${conceptOrder}`.
  // Each syllabus version owns its concepts — no cross-version upsert.
  const conceptsToEmbed: Array<{ id: string; text: string }> = [];

  let conceptCount = 0;
  for (const u of extracted.units) {
    const uId = unitIdByOrder.get(u.order) ?? makeUnitId(syllabusId, u.order);
    for (const c of u.concepts) {
      const cId = `${syllabusId}:c${u.order}.${c.order}`;
      await db.execute(sql`
        INSERT INTO ${schema.concepts} (
          id, syllabus_id, unit_id, "order", name,
          learning_objective, syllabus_excerpt, neighborhood
        )
        VALUES (
          ${cId},
          ${syllabusId},
          ${uId},
          ${c.order},
          ${c.name},
          ${c.learningObjective ?? null},
          ${c.syllabusExcerpt ?? null},
          NULL
        )
        ON CONFLICT (id) DO NOTHING
      `);
      conceptCount += 1;

      const embedText = [c.name, c.learningObjective]
        .filter(Boolean)
        .join(" ");
      conceptsToEmbed.push({ id: cId, text: embedText });
    }
  }

  // ------------------------------------------------------------------
  // 7. Embed concepts (batch, concurrency=2, same pattern as pipeline.ts).
  // ------------------------------------------------------------------
  const modelId = embed.defaultModelId;

  // Guard the empty-array case — pg-node can surface the "op ANY/ALL (array)
  // requires array on right side" error in some edge cases. If we have no
  // concepts to embed, skip the lookup entirely.
  const haveEmbeddings = new Set<string>();
  if (conceptsToEmbed.length > 0) {
    const existingRows = await pool.query<{ concept_id: string }>(
      `SELECT concept_id FROM concept_embeddings
       WHERE model_id = $1 AND concept_id = ANY($2::text[])`,
      [modelId, conceptsToEmbed.map((c) => c.id)],
    );
    for (const r of existingRows.rows) haveEmbeddings.add(r.concept_id);
  }
  const todo = conceptsToEmbed.filter((c) => !haveEmbeddings.has(c.id));

  const batches: Array<typeof todo> = [];
  for (let i = 0; i < todo.length; i += EMBED_BATCH_SIZE) {
    batches.push(todo.slice(i, i + EMBED_BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
    const slice = batches.slice(i, i + EMBED_CONCURRENCY);
    const results = await Promise.all(
      slice.map((batch) =>
        embed.embed({
          texts: batch.map((b) => b.text),
          inputType: "search_document",
        }),
      ),
    );

    for (let bi = 0; bi < slice.length; bi += 1) {
      const batch = slice[bi]!;
      const embedResult = results[bi]!;
      if (embedResult.dim !== 1024) {
        throw new Error(
          `embed returned dim=${embedResult.dim}, expected 1024`,
        );
      }
      for (let vi = 0; vi < batch.length; vi += 1) {
        const item = batch[vi]!;
        const vec = embedResult.vectors[vi]!;
        await pool.query(
          `INSERT INTO concept_embeddings (concept_id, model_id, dim, vector)
           VALUES ($1, $2, $3, $4::vector)
           ON CONFLICT (concept_id, model_id) DO NOTHING`,
          [item.id, modelId, embedResult.dim, `[${vec.join(",")}]`],
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 8. Mark syllabus as ready.
  // ------------------------------------------------------------------
  await db.execute(sql`
    UPDATE ${schema.syllabuses}
    SET status = 'ready'
    WHERE id = ${syllabusId}
  `);

  return {
    syllabusId,
    subjectId: sId,   // already set at upload time; returned for observability
    conceptCount,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Top-level BullMQ job handler: wraps runSyllabusExtraction and persists
 * failure_reason before re-throwing so BullMQ marks the job as failed.
 */
export async function processSyllabusJob(opts: {
  syllabusId: string;
  userId: string;
}): Promise<SyllabusExtractionResult> {
  try {
    return await runSyllabusExtraction(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort DB write — don't let a secondary failure obscure the original.
    try {
      await db.execute(sql`
        UPDATE ${schema.syllabuses}
        SET status = 'failed', failure_reason = ${message}
        WHERE id = ${opts.syllabusId}
      `);
    } catch {
      // ignore
    }
    throw err;
  }
}
