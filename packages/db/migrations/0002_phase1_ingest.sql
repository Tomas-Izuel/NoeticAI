-- Phase 1 — ingest backbone: subjects, units, notes, fragments, embeddings.
-- pgvector extension + HNSW index on the fragment-embedding column.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  course TEXT,
  term TEXT,
  glyph TEXT,
  -- Spanish-first (plan.md §4.2 multilingual note).
  lang TEXT NOT NULL DEFAULT 'es',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subjects_user_idx ON subjects(user_id);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  "order" INTEGER NOT NULL,
  name TEXT NOT NULL,
  weeks_label TEXT,
  source_unit_ref JSONB
);

CREATE INDEX IF NOT EXISTS units_subject_idx ON units(subject_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at_external TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS notes_source_external_uq
  ON notes(source_type, external_id);

CREATE INDEX IF NOT EXISTS notes_subject_idx ON notes(subject_id);

-- id = sha256(external_id + position + text_hash). Stable across reruns
-- while content is unchanged — drives the "no re-embed on rerun" gate.
CREATE TABLE IF NOT EXISTS note_fragments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_fragments_note_idx ON note_fragments(note_id);

CREATE TABLE IF NOT EXISTS note_fragment_embeddings (
  fragment_id TEXT NOT NULL REFERENCES note_fragments(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector vector(1024) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (fragment_id, model_id)
);

-- HNSW index for cosine similarity. m=16, ef_construction=64 are pgvector
-- defaults; tune later if recall@k slips. Cosine ops because we store
-- raw (un-normalized) embeddings from Cohere.
CREATE INDEX IF NOT EXISTS note_fragment_embeddings_vector_hnsw
  ON note_fragment_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
