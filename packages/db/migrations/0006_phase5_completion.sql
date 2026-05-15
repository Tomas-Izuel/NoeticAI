-- Phase 5 — grounded completion: completions + citations.
-- Builds on Phase 3 audit (gaps, audit_runs, concepts) and Phase 4 bibliography (source_chunks).

CREATE TABLE IF NOT EXISTS completions (
  id TEXT PRIMARY KEY,
  gap_id TEXT NOT NULL REFERENCES gaps(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  summary TEXT,
  paragraphs JSONB,
  confidence NUMERIC(6, 4),
  model_id TEXT NOT NULL,
  embed_model_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
  guard_failure_reason TEXT,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS completions_concept_idx ON completions(concept_id, created_at);
CREATE INDEX IF NOT EXISTS completions_gap_idx ON completions(gap_id, created_at);
CREATE INDEX IF NOT EXISTS completions_run_idx ON completions(audit_run_id);
CREATE INDEX IF NOT EXISTS completions_concept_created_idx ON completions(concept_id, created_at DESC);

CREATE TABLE IF NOT EXISTS citations (
  completion_id TEXT NOT NULL REFERENCES completions(id) ON DELETE CASCADE,
  paragraph_index INTEGER NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
  similarity NUMERIC(6, 4) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (completion_id, paragraph_index, chunk_id)
);

CREATE INDEX IF NOT EXISTS citations_completion_idx ON citations(completion_id);
CREATE INDEX IF NOT EXISTS citations_chunk_idx ON citations(chunk_id);
