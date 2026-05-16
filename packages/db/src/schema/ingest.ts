import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  uniqueIndex,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { sourceConnections } from "./connections";
import { vector } from "./types";

// Phase 1 schema — supports the ingest pipeline (StubConnector → fragments
// → embeddings → cosine retrieval). Concepts, sources, audit-runs are not
// yet here; they land in Phase 2/3/4 per implementation.md.

export const subjects = pgTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Tracks which source_connection created this subject via the multi-subject
    // sync endpoint. NULL for subjects created via the stub or dev paths.
    // ON DELETE SET NULL: connection revocation doesn't destroy the subject.
    connectionId: text("connection_id").references(
      () => sourceConnections.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    course: text("course"),
    term: text("term"),
    glyph: text("glyph"),
    // Per-subject language. Drives embed-model selection (multilingual vs english).
    // Defaults to Spanish per project context.
    lang: text("lang").notNull().default("es"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    connectionIdIdx: index("subjects_connection_id_idx").on(t.connectionId),
  }),
);

export const units = pgTable("units", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id, { onDelete: "cascade" }),
  order: integer("order").notNull(),
  name: text("name").notNull(),
  weeksLabel: text("weeks_label"),
  // Optional connector resource ref this unit maps to.
  sourceUnitRef: jsonb("source_unit_ref"),
});

// Notes hold connector metadata only — body is fragmented + indexed but the
// canonical body still lives in the source (plan.md §5.1).
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    unitId: text("unit_id").references(() => units.id, {
      onDelete: "set null",
    }),
    sourceType: text("source_type").notNull(), // "stub" | "notion" | ...
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    updatedAtExternal: timestamp("updated_at_external"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalUq: uniqueIndex("notes_source_external_uq").on(
      t.sourceType,
      t.externalId,
    ),
  }),
);

// id = sha256(externalId + position + textHash). Stable across runs while
// content is unchanged — drives the no-re-embed-on-rerun gate.
export const noteFragments = pgTable("note_fragments", {
  id: text("id").primaryKey(),
  noteId: text("note_id")
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  kind: text("kind").notNull(), // paragraph|bullet|numbered|todo|quote|code
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const noteFragmentEmbeddings = pgTable(
  "note_fragment_embeddings",
  {
    fragmentId: text("fragment_id")
      .notNull()
      .references(() => noteFragments.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dim: integer("dim").notNull(),
    vector: vector("vector", 1024).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fragmentId, t.modelId] }),
  }),
);
