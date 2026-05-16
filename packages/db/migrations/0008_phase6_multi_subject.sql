-- Phase 6 multi-subject — adds connection_id to subjects so the sync
-- endpoint can cleanly hard-delete subjects that were created via a specific
-- connection without touching subjects from other connections or stub paths.
--
-- All FK cascades are already in place across the existing tables (units,
-- notes, syllabuses, audit_runs, concept_fragment_links, mastery_scores,
-- gaps, completions, citations, note_fragments, note_fragment_embeddings,
-- concept_embeddings). No cascade fixes needed.

-- ---------------------------------------------------------------------------
-- Add connection_id to subjects.
-- Nullable: rows created via the stub connector or dev paths keep NULL.
-- ON DELETE SET NULL: if the source_connection is revoked/deleted, the
-- subject survives (data is not owned by the connection, only tagged by it).
-- ---------------------------------------------------------------------------
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS connection_id TEXT
    REFERENCES source_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS subjects_connection_id_idx
  ON subjects(connection_id);
