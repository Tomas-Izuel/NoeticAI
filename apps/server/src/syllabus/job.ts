import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db, pool } from "../db";
import { llm, embed } from "../ai";
import { extractPdfText } from "./extract";
import { buildExtractionPrompt, type ExtractedSyllabus } from "./prompt";

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
// JSON parsing with leniency
// ---------------------------------------------------------------------------

/**
 * Parse the LLM's text output to ExtractedSyllabus. The model is instructed
 * to return bare JSON, but in dev (Ollama/gemma) it may wrap the output in
 * markdown fences. We handle that gracefully.
 */
function parseLlmResponse(raw: string): ExtractedSyllabus {
  let text = raw.trim();

  // Strip ```json ... ``` or ``` ... ``` fences if present.
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Try a direct parse first.
  try {
    const parsed: unknown = JSON.parse(text);
    return ExtractedSyllabusSchema.parse(parsed);
  } catch {
    // Outermost {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (match && match[0]) {
      try {
        const parsed: unknown = JSON.parse(match[0]);
        return ExtractedSyllabusSchema.parse(parsed);
      } catch {
        /* fall through */
      }
    }
    // Truncation salvage: depth-aware close. Walks the JSON tracking nesting
    // and string state, finds the longest valid prefix, and synthesises the
    // closing brackets/braces. Dev safety net — `prod-changes.md` notes the
    // removal once we're on Bedrock + Opus.
    const salvaged = trySalvageTruncatedJson(text);
    if (salvaged) {
      try {
        const parsed: unknown = JSON.parse(salvaged);
        return ExtractedSyllabusSchema.parse(parsed);
      } catch {
        /* fall through */
      }
    }
    throw new Error(
      `LLM response could not be parsed as ExtractedSyllabus. ` +
        `length=${raw.length}. ` +
        `head=${JSON.stringify(raw.slice(0, 200))}. ` +
        `tail=${JSON.stringify(raw.slice(-200))}.`,
    );
  }
}

function trySalvageTruncatedJson(text: string): string | null {
  // Walk the text once, collecting every position right after a `}` that's
  // not inside a string — those are the only "between-fields" cuts we can
  // close cleanly. Then iterate them right-to-left (longest prefix first),
  // synthesise the closing sequence, and return the first one that parses.
  //
  // Implementation: O(n) for collection, then O(k) closes per attempt where
  // k = nesting depth. Total work is bounded by the JSON depth × number of
  // closing braces, which is fine for syllabus-sized payloads.

  const closes: number[] = []; // positions one-past the `}`
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "}") closes.push(i + 1);
  }

  for (let idx = closes.length - 1; idx >= 0; idx -= 1) {
    const cut = closes[idx]!;
    const head = text.slice(0, cut);
    const tail = computeClosingBrackets(head);
    if (tail === null) continue;
    const candidate = head + tail;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try an earlier cut.
    }
  }
  return null;
}

function computeClosingBrackets(head: string): string | null {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < head.length; i += 1) {
    const ch = head[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      if (stack.length === 0) return null;
      stack.pop();
    }
  }
  if (inString) return null;
  return stack
    .reverse()
    .map((c) => (c === "{" ? "}" : "]"))
    .join("");
}

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Content-addressed subject id: sha256(userId + name).slice(0, 24). */
function subjectId(userId: string, name: string): string {
  return sha256Hex(userId + name).slice(0, 24);
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
  // 1. Load the syllabuses row to get the stored PDF path.
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
  const { source_path: sourcePath, source_filename: sourceFilename } = syllabusRow;

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
  const extracted = parseLlmResponse(result.text);

  // ------------------------------------------------------------------
  // 6. Idempotent upsert of subject, units, concepts.
  // ------------------------------------------------------------------

  // Subject: content-addressed id on (userId, name). If the syllabus
  // says no subject name, fall back to "Materia sin nombre".
  const subjectName = extracted.subject.name.trim() || "Materia sin nombre";
  const sId = subjectId(userId, subjectName);

  await db.execute(sql`
    INSERT INTO ${schema.subjects} (id, user_id, name, course, term, lang)
    VALUES (
      ${sId},
      ${userId},
      ${subjectName},
      ${extracted.subject.course ?? null},
      ${extracted.subject.term ?? null},
      'es'
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      course = COALESCE(EXCLUDED.course, ${schema.subjects}.course),
      term  = COALESCE(EXCLUDED.term,  ${schema.subjects}.term),
      updated_at = NOW()
  `);

  // Bind syllabus to the subject (in case it was created with a placeholder
  // subject_id at upload time and we now know the real one).
  await db.execute(sql`
    UPDATE ${schema.syllabuses}
    SET subject_id = ${sId}
    WHERE id = ${syllabusId}
  `);

  // Units: id = `${sId}:u${order}`. Upsert by id.
  for (const u of extracted.units) {
    const uId = `${sId}:u${u.order}`;
    await db.execute(sql`
      INSERT INTO ${schema.units} (id, subject_id, "order", name, weeks_label)
      VALUES (${uId}, ${sId}, ${u.order}, ${u.name}, ${u.weeksLabel ?? null})
      ON CONFLICT (id) DO UPDATE SET
        name        = EXCLUDED.name,
        "order"     = EXCLUDED."order",
        weeks_label = EXCLUDED.weeks_label
    `);
  }

  // Concepts: id = `${syllabusId}:c${unitOrder}.${conceptOrder}`.
  // Each syllabus version owns its concepts — no cross-version upsert.
  const conceptsToEmbed: Array<{ id: string; text: string }> = [];

  let conceptCount = 0;
  for (const u of extracted.units) {
    const uId = `${sId}:u${u.order}`;
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
    subjectId: sId,
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
