import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { subjects, noteFragments } from "./ingest";
import { syllabuses, concepts } from "./curriculum";

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    syllabusId: text("syllabus_id")
      .notNull()
      .references(() => syllabuses.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // queued|running|succeeded|failed
    thresholdsJson: jsonb("thresholds_json").notNull(),
    modelsJson: jsonb("models_json").notNull(),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    bySubject: index("audit_runs_subject_idx").on(t.subjectId, t.startedAt),
    bySubjectStatus: index("audit_runs_subject_status_idx").on(
      t.subjectId,
      t.status,
      t.finishedAt,
    ),
  }),
);

export const conceptFragmentLinks = pgTable(
  "concept_fragment_links",
  {
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    fragmentId: text("fragment_id")
      .notNull()
      .references(() => noteFragments.id, { onDelete: "cascade" }),
    similarity: numeric("similarity", { precision: 6, scale: 4 }).notNull(),
    verdict: text("verdict").notNull(), // engages|mentions|tangential|off-topic
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.auditRunId, t.conceptId, t.fragmentId] }),
    byRunConcept: index("concept_fragment_links_run_concept_idx").on(
      t.auditRunId,
      t.conceptId,
    ),
    byFragment: index("concept_fragment_links_fragment_idx").on(t.fragmentId),
  }),
);

export const masteryScores = pgTable(
  "mastery_scores",
  {
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    state: text("state").notNull(), // green|amber|red
    depth: numeric("depth", { precision: 6, scale: 4 }).notNull(),
    mentions: integer("mentions").notNull().default(0),
    sources: integer("sources").notNull().default(0),
    fragments: integer("fragments").notNull().default(0),
    conflict: boolean("conflict").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.auditRunId, t.conceptId] }),
    byRunState: index("mastery_scores_run_state_idx").on(t.auditRunId, t.state),
  }),
);

export const gaps = pgTable(
  "gaps",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    firstDetectedInRun: text("first_detected_in_run")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    latestRunId: text("latest_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    currentState: text("current_state").notNull(), // amber|red
    status: text("status").notNull(), // open|dismissed|completed|snoozed
    firstDetectedAt: timestamp("first_detected_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    openConcept: uniqueIndex("gaps_concept_open_uq")
      .on(t.conceptId)
      .where(sql`${t.status} = 'open'`),
    byLatestRun: index("gaps_latest_run_idx").on(t.latestRunId),
  }),
);
