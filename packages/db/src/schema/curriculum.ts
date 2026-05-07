import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { subjects, units } from "./ingest";
import { vector } from "./types";

// Phase 2 schema — curriculum: syllabuses, concepts, concept embeddings.
// syllabus status lifecycle: queued → extracting → ready → confirmed (or failed).

export const syllabuses = pgTable(
  "syllabuses",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // queued | extracting | ready | failed | confirmed
    status: text("status").notNull(),
    // relative path under apps/server/uploads/
    sourcePath: text("source_path").notNull(),
    sourceFilename: text("source_filename").notNull(),
    pageCount: integer("page_count"),
    isActive: boolean("is_active").notNull().default(false),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => ({
    subjectVersionUq: unique("syllabuses_subject_version_uq").on(
      t.subjectId,
      t.version,
    ),
  }),
);

export const concepts = pgTable("concepts", {
  id: text("id").primaryKey(),
  syllabusId: text("syllabus_id")
    .notNull()
    .references(() => syllabuses.id, { onDelete: "cascade" }),
  unitId: text("unit_id").references(() => units.id, {
    onDelete: "set null",
  }),
  // "order" is a reserved SQL keyword — quoted in the migration.
  order: integer("order").notNull(),
  name: text("name").notNull(),
  learningObjective: text("learning_objective"),
  syllabusExcerpt: text("syllabus_excerpt"),
  // List of related concept ids (from neighborhood inference during extraction).
  neighborhood: jsonb("neighborhood"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const conceptEmbeddings = pgTable(
  "concept_embeddings",
  {
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dim: integer("dim").notNull(),
    vector: vector("vector", 1024).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conceptId, t.modelId] }),
  }),
);
