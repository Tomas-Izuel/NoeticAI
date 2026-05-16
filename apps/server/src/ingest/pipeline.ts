import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db, pool } from "../db";
import { connectorRegistry } from "../connectors/registry";
import { embed } from "../ai";
import { deriveFragments } from "./fragments";

const EMBED_CONCURRENCY = 2;
const EMBED_BATCH_SIZE = 8; // per Cohere call; well under the 96-text limit.

export interface IngestResult {
  subjectId: string;
  notesIngested: number;
  fragmentsAdded: number;
  fragmentsExisting: number;
  embeddingsAdded: number;
  embeddingsSkipped: number;
  modelId: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// runIngest
//
// Ingests a single subject identified by subjectExternalId. The connector's
// listSubjects() is called to locate the matching subject; a missing id is a
// hard error (the caller should ensure the subject exists before enqueuing).
//
// For source="stub" the connector returns exactly one subject; subjectExternalId
// must match that subject's id (or "auto" for backward-compat on the stub path
// — see apps/server/src/dev/ingest.ts).
// ---------------------------------------------------------------------------

export async function runIngest(opts: {
  userId: string;
  source: string;
  subjectExternalId: string;
}): Promise<IngestResult> {
  const startedAt = performance.now();
  const connector = connectorRegistry.get(opts.source);
  if (!connector) throw new Error(`no connector registered for source=${opts.source}`);

  const subjects = await connector.listSubjects({ userId: opts.userId });
  if (subjects.length === 0) {
    throw new Error(`connector ${opts.source} returned no subjects`);
  }

  const subject = subjects.find((s) => s.id === opts.subjectExternalId);
  if (!subject) {
    throw new Error(
      `subject externalId=${opts.subjectExternalId} not found in connector ${opts.source}`,
    );
  }

  // Upsert subject (per-user). The connector's subject.id is treated as a
  // stable external identifier; we mirror it directly into our pk.
  await db.execute(sql`
    INSERT INTO ${schema.subjects} (id, user_id, name, course, term, glyph, lang)
    VALUES (${subject.id}, ${opts.userId}, ${subject.name}, ${subject.course ?? null}, ${subject.term ?? null}, ${subject.glyph ?? null}, 'es')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      course = EXCLUDED.course,
      term = EXCLUDED.term,
      glyph = EXCLUDED.glyph,
      updated_at = NOW()
  `);

  // Upsert units.
  const units = await connector.listUnits({ userId: opts.userId, subjectId: subject.id });
  for (const u of units) {
    await db.execute(sql`
      INSERT INTO ${schema.units} (id, subject_id, "order", name, weeks_label, source_unit_ref)
      VALUES (${u.id}, ${u.subjectId}, ${u.order}, ${u.name}, ${u.weeksLabel ?? null}, ${u.sourceUnitRef ? sql`${JSON.stringify(u.sourceUnitRef)}::jsonb` : null})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        "order" = EXCLUDED."order",
        weeks_label = EXCLUDED.weeks_label
    `);
  }

  // List notes + upsert metadata, then fragment + embed.
  const noteSummaries = await connector.listNotes({ userId: opts.userId, subjectId: subject.id });

  let notesIngested = 0;
  let fragmentsAdded = 0;
  let fragmentsExisting = 0;
  const fragmentsToEmbed: Array<{ id: string; text: string }> = [];

  // Stable-ish note id derived from source + externalId so reruns don't churn.
  for (const summary of noteSummaries) {
    const noteId = `${summary.ref.source}:${summary.ref.externalId}`;
    await db.execute(sql`
      INSERT INTO ${schema.notes} (id, subject_id, unit_id, source_type, external_id, title, updated_at_external)
      VALUES (${noteId}, ${subject.id}, ${summary.unitId ?? null}, ${summary.ref.source}, ${summary.ref.externalId}, ${summary.title}, ${summary.updatedAtExternal})
      ON CONFLICT (source_type, external_id) DO UPDATE SET
        title = EXCLUDED.title,
        unit_id = EXCLUDED.unit_id,
        updated_at_external = EXCLUDED.updated_at_external,
        updated_at = NOW()
    `);
    notesIngested += 1;

    const content = await connector.fetchNote({ userId: opts.userId, ref: summary.ref });
    const fragments = deriveFragments(content);

    for (const f of fragments) {
      const inserted = await db.execute<{ id: string }>(sql`
        INSERT INTO ${schema.noteFragments} (id, note_id, position, kind, text, text_hash)
        VALUES (${f.id}, ${noteId}, ${f.position}, ${f.kind}, ${f.text}, ${f.textHash})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `);
      if (inserted.rowCount && inserted.rowCount > 0) {
        fragmentsAdded += 1;
      } else {
        fragmentsExisting += 1;
      }
      if (f.embeddable) fragmentsToEmbed.push({ id: f.id, text: f.text });
    }
  }

  // Skip fragments that already have an embedding for the active model.
  // The model is whatever the configured embed client uses — Cohere on
  // Bedrock in prod, bge-m3 on Ollama in dev. Per-Subject language routing
  // (multilingual vs english) lands when subjects.lang drives a per-call
  // override in Phase 2.
  const modelId = embed.defaultModelId;
  let embeddingsSkipped = 0;
  let embeddingsAdded = 0;

  const fragmentIds = fragmentsToEmbed.map((f) => f.id);
  if (fragmentIds.length > 0) {
    // pg requires an explicit text[] cast — Drizzle's sql template doesn't
    // auto-promote JS arrays to PG arrays, but the driver does when cast.
    const existing = await pool.query<{ fragment_id: string }>(
      `SELECT fragment_id FROM note_fragment_embeddings
       WHERE model_id = $1 AND fragment_id = ANY($2::text[])`,
      [modelId, fragmentIds],
    );
    const have = new Set(existing.rows.map((r) => r.fragment_id));
    embeddingsSkipped = have.size;
    const todo = fragmentsToEmbed.filter((f) => !have.has(f.id));

    // Batched, parallel embedding with worker-style concurrency bound.
    const batches: typeof todo[] = [];
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
        const result = results[bi]!;
        if (result.dim !== 1024) {
          throw new Error(`embed returned dim=${result.dim}, expected 1024`);
        }
        for (let vi = 0; vi < batch.length; vi += 1) {
          const item = batch[vi]!;
          const vec = result.vectors[vi]!;
          await pool.query(
            `INSERT INTO note_fragment_embeddings (fragment_id, model_id, dim, vector)
             VALUES ($1, $2, $3, $4::vector)
             ON CONFLICT (fragment_id, model_id) DO NOTHING`,
            [item.id, modelId, result.dim, `[${vec.join(",")}]`],
          );
          embeddingsAdded += 1;
        }
      }
    }
  }

  return {
    subjectId: subject.id,
    notesIngested,
    fragmentsAdded,
    fragmentsExisting,
    embeddingsAdded,
    embeddingsSkipped,
    modelId,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
