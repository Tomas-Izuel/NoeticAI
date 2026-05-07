-- Phase 2 — curriculum: syllabuses, concepts, concept embeddings.
-- Builds on Phase 1's subjects + units tables.

CREATE TABLE IF NOT EXISTS syllabuses (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,                    -- queued|extracting|ready|failed|confirmed
  source_path TEXT NOT NULL,               -- relative path under apps/server/uploads/
  source_filename TEXT NOT NULL,
  page_count INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMP,
  UNIQUE (subject_id, version)
);

CREATE INDEX IF NOT EXISTS syllabuses_subject_idx ON syllabuses(subject_id);
CREATE INDEX IF NOT EXISTS syllabuses_active_idx ON syllabuses(subject_id, is_active);

CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY,
  syllabus_id TEXT NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  learning_objective TEXT,
  syllabus_excerpt TEXT,
  neighborhood JSONB,                      -- list of related concept ids
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS concepts_syllabus_idx ON concepts(syllabus_id);
CREATE INDEX IF NOT EXISTS concepts_unit_idx ON concepts(unit_id);

CREATE TABLE IF NOT EXISTS concept_embeddings (
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector vector(1024) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (concept_id, model_id)
);

CREATE INDEX IF NOT EXISTS concept_embeddings_vector_hnsw
  ON concept_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
