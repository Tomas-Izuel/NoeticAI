import {
  pgTable, text, integer, timestamp, primaryKey, jsonb, numeric, index,
} from "drizzle-orm/pg-core";
import { gaps, auditRuns } from "./audit";
import { concepts } from "./curriculum";
import { sourceChunks } from "./bibliography";

export const completions = pgTable(
  "completions",
  {
    id: text("id").primaryKey(),                     // sha256(gapId + promptHash + modelId).slice(0,24)
    gapId: text("gap_id")
      .notNull()
      .references(() => gaps.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")                    // denormalised — the screen queries by conceptId
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    // pending: generated, awaiting user merge/reject
    // merged_locally: user clicked "merge" — UI annotates the note locally; v1 doesn't write back
    // edited: user opened the editor (placeholder for v1.1)
    // rejected: user dismissed
    // null_no_grounding: hallucination guard returned null — explicit empty state
    // failed: generation errored
    // queued: job enqueued, not yet picked up by worker
    // running: worker is actively generating
    status: text("status").notNull(),
    // null when status='null_no_grounding' or 'failed'
    summary: text("summary"),
    // null when status='null_no_grounding' or 'failed'
    // shape: Array<{ text: string; sourceIds: string[] }>
    paragraphs: jsonb("paragraphs"),
    // 0..1; null when status='null_no_grounding' or 'failed'
    confidence: numeric("confidence", { precision: 6, scale: 4 }),
    // Snapshot what produced this row, so re-embed/regen targets correctly.
    // Mirrors note_fragment_embeddings.model_id pattern (per prod-changes §1).
    modelId: text("model_id").notNull(),             // e.g. "anthropic.claude-sonnet-4-..." or "ollama:gemma4:e4b"
    embedModelId: text("embed_model_id").notNull(),  // model used for guard re-similarity
    promptHash: text("prompt_hash").notNull(),       // sha256(system+subject+concept layers); identifies cache identity
    // Diagnostics for the cost badge + eval harness.
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheWriteInputTokens: integer("cache_write_input_tokens").notNull().default(0),
    // Why the guard returned null, when it did. Free-form, for debugging.
    guardFailureReason: text("guard_failure_reason"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byConcept: index("completions_concept_idx").on(t.conceptId, t.createdAt),
    byGap: index("completions_gap_idx").on(t.gapId, t.createdAt),
    byRun: index("completions_run_idx").on(t.auditRunId),
    // Latest-by-concept lookup pattern: ORDER BY created_at DESC LIMIT 1 hits this index.
    latestByConcept: index("completions_concept_created_idx").on(t.conceptId, t.createdAt.desc()),
  }),
);

export const citations = pgTable(
  "citations",
  {
    completionId: text("completion_id")
      .notNull()
      .references(() => completions.id, { onDelete: "cascade" }),
    paragraphIndex: integer("paragraph_index").notNull(),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => sourceChunks.id, { onDelete: "cascade" }),
    similarity: numeric("similarity", { precision: 6, scale: 4 }).notNull(), // re-embed sim, not retrieval sim
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.completionId, t.paragraphIndex, t.chunkId] }),
    byCompletion: index("citations_completion_idx").on(t.completionId),
    byChunk: index("citations_chunk_idx").on(t.chunkId),
  }),
);
