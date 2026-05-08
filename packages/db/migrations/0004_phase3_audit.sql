-- Phase 3 — audit: runs, concept-fragment links, mastery scores, gaps.
-- Builds on Phase 1 (notes/fragments) + Phase 2 (syllabuses/concepts).

-- ---------------------------------------------------------------------------
-- audit_runs: one row per audit invocation. Snapshots thresholds + model ids
-- so a re-score is reproducible after thresholds change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  syllabus_id TEXT NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                    -- queued|running|succeeded|failed
  thresholds_json JSONB NOT NULL,          -- snapshot of CoverageThresholds
  models_json JSONB NOT NULL,              -- { embed, haiku } at run time
  failure_reason TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_runs_subject_idx
  ON audit_runs(subject_id, started_at DESC);
-- Used by GET /api/subjects/:id/audit/latest — pulls the newest succeeded run.
CREATE INDEX IF NOT EXISTS audit_runs_subject_status_idx
  ON audit_runs(subject_id, status, finished_at DESC);

-- ---------------------------------------------------------------------------
-- concept_fragment_links: N:M (concept × fragment) per audit run.
-- One row per (run, concept, fragment) survivor of the two-stage alignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concept_fragment_links (
  audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  concept_id   TEXT NOT NULL REFERENCES concepts(id)   ON DELETE CASCADE,
  fragment_id  TEXT NOT NULL REFERENCES note_fragments(id) ON DELETE CASCADE,
  similarity   NUMERIC(6,4) NOT NULL,           -- cosine score 0..1
  verdict      TEXT NOT NULL,                   -- engages|mentions|tangential|off-topic
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_run_id, concept_id, fragment_id)
);

-- Per-concept lookup for the audit-detail trace and scoring step.
CREATE INDEX IF NOT EXISTS concept_fragment_links_run_concept_idx
  ON concept_fragment_links(audit_run_id, concept_id);
-- For fragment-side joins (e.g. "which concepts does this fragment cover?").
CREATE INDEX IF NOT EXISTS concept_fragment_links_fragment_idx
  ON concept_fragment_links(fragment_id);

-- ---------------------------------------------------------------------------
-- mastery_scores: per (audit_run, concept) summary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mastery_scores (
  audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  concept_id   TEXT NOT NULL REFERENCES concepts(id)   ON DELETE CASCADE,
  state        TEXT NOT NULL,                   -- green|amber|red
  depth        NUMERIC(6,4) NOT NULL,           -- 0..1
  mentions     INTEGER NOT NULL DEFAULT 0,
  sources      INTEGER NOT NULL DEFAULT 0,
  fragments    INTEGER NOT NULL DEFAULT 0,
  conflict     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_run_id, concept_id)
);

-- Per-run pulls grouped by state for the audit screen.
CREATE INDEX IF NOT EXISTS mastery_scores_run_state_idx
  ON mastery_scores(audit_run_id, state);

-- ---------------------------------------------------------------------------
-- gaps: an open item per concept whose state ∈ {amber, red}. Idempotent
-- across runs — one row per concept whose status='open'; updated each run
-- with current_state and latest_run_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gaps (
  id                       TEXT PRIMARY KEY,
  concept_id               TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  first_detected_in_run    TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  latest_run_id            TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  current_state            TEXT NOT NULL,        -- amber|red (never green)
  status                   TEXT NOT NULL,        -- open|dismissed|completed|snoozed
  first_detected_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  dismissed_at             TIMESTAMP,
  completed_at             TIMESTAMP
);

-- One open gap per concept, enforced at the DB level (so re-runs UPSERT cleanly).
CREATE UNIQUE INDEX IF NOT EXISTS gaps_concept_open_uq
  ON gaps(concept_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS gaps_latest_run_idx
  ON gaps(latest_run_id);
