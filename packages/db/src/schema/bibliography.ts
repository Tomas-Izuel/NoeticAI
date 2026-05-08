import {
  pgTable, text, integer, timestamp, primaryKey, unique, index,
} from "drizzle-orm/pg-core";
import { subjects } from "./ingest";
import { vector } from "./types";

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),                // pdf|url
    title: text("title").notNull(),
    author: text("author"),
    year: integer("year"),
    status: text("status").notNull(),            // uploading|chunking|embedded|ready|failed|partial
    sourcePath: text("source_path"),
    sourceFilename: text("source_filename"),
    externalUrl: text("external_url"),
    fetchedAt: timestamp("fetched_at"),
    pageCount: integer("page_count"),
    byteCount: integer("byte_count"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySubject: index("sources_subject_idx").on(t.subjectId),
    bySubjectStatus: index("sources_subject_status_idx").on(t.subjectId, t.status),
  }),
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    chapterLabel: text("chapter_label"),
    pagesLabel: text("pages_label"),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    charCount: integer("char_count").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bySource: index("source_chunks_source_idx").on(t.sourceId),
    sourcePositionUq: unique("source_chunks_source_position_uq").on(t.sourceId, t.position),
  }),
);

export const sourceChunkEmbeddings = pgTable(
  "source_chunk_embeddings",
  {
    chunkId: text("chunk_id").notNull().references(() => sourceChunks.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dim: integer("dim").notNull(),
    vector: vector("vector", 1024).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.chunkId, t.modelId] }) }),
);
