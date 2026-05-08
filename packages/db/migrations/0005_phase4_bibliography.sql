-- Phase 4 — bibliography: sources, chunks, chunk embeddings.
-- Builds on Phase 1's subjects table.

-- ---------------------------------------------------------------------------
-- sources: one row per uploaded PDF or pasted URL. The blob/text is
-- materialised by the ingest job; the row is created in 'uploading' state at
-- POST time and walks the lifecycle:
--   uploading → chunking → embedded → ready
--                ↘ failed                 (terminal, with failure_reason)
--                ↘ partial                (terminal — extracted some text but hit a recoverable cap;
--                                          rare in v1, reserved for v1.1 OCR/long-PDF fallback)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- pdf|url
  title TEXT NOT NULL,                       -- user-supplied or filename / URL host fallback
  author TEXT,                               -- v1: nullable; populated by user later if surfaced in UI
  year INTEGER,                              -- v1: nullable
  status TEXT NOT NULL,                      -- uploading|chunking|embedded|ready|failed|partial
  -- For PDFs: relative path under apps/server/uploads/sources/ (mirrors syllabuses pattern).
  source_path TEXT,
  source_filename TEXT,
  -- For URLs: the canonical URL we fetched, plus the on-disk cached HTML/text.
  external_url TEXT,
  fetched_at TIMESTAMP,
  page_count INTEGER,
  byte_count INTEGER,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sources_subject_idx ON sources(subject_id);
CREATE INDEX IF NOT EXISTS sources_subject_status_idx ON sources(subject_id, status);

-- ---------------------------------------------------------------------------
-- source_chunks: one row per content slice. position is monotonic within a
-- source. chapter_label is NULL in v1 (chapter detection deferred — see
-- prod-changes.md). pages_label is "p. 12" or "pp. 12–14" — built from the
-- per-page extraction. text is plain UTF-8.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  chapter_label TEXT,                        -- v1: always NULL; reserved
  pages_label TEXT,                          -- "p. 12" or "pp. 12–14"; NULL for URL kind
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,                   -- sha256(text) — drives skip-if-already-embedded
  char_count INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, position)
);

CREATE INDEX IF NOT EXISTS source_chunks_source_idx ON source_chunks(source_id);

-- ---------------------------------------------------------------------------
-- source_chunk_embeddings: one vector per (chunk, model_id). Same shape as
-- note_fragment_embeddings + concept_embeddings (dim 1024). HNSW cosine
-- index for retrieval. Row is added by the embed step; a chunk with no row
-- under the active model has not been embedded yet under that model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_chunk_embeddings (
  chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector vector(1024) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chunk_id, model_id)
);

-- HNSW for cosine retrieval. m=16, ef_construction=64 match the existing
-- note_fragment_embeddings + concept_embeddings indexes — keep the knobs
-- consistent across all embedding tables until a recall regression forces
-- per-table tuning.
CREATE INDEX IF NOT EXISTS source_chunk_embeddings_vector_hnsw
  ON source_chunk_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
