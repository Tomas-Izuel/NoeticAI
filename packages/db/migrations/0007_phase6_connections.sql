-- Phase 6 — OAuth connections, CSRF states, structure mappings.
-- Enables the Notion OAuth connect wizard and per-user connector config.

-- ---------------------------------------------------------------------------
-- source_connections: sealed OAuth tokens for connected workspaces.
-- status lifecycle: active → revoked | error
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  workspace_icon TEXT,
  bot_id TEXT,
  access_token_sealed TEXT NOT NULL,
  refresh_token_sealed TEXT,
  token_type TEXT NOT NULL DEFAULT 'bearer',
  expires_at TIMESTAMPTZ,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, source, workspace_id)
);

CREATE INDEX IF NOT EXISTS source_connections_user_idx ON source_connections(user_id);
CREATE INDEX IF NOT EXISTS source_connections_user_source_idx ON source_connections(user_id, source, status);

-- ---------------------------------------------------------------------------
-- oauth_states: short-lived CSRF nonces. Deleted on first use.
-- expires_at index is load-bearing for future cleanup jobs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  redirect_after TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);

-- ---------------------------------------------------------------------------
-- structure_mappings: links a source_connection to a subject via a named
-- strategy. Only one active mapping per (connection, subject) is expected
-- (enforced at the application layer — a partial unique index would need
-- a deferred constraint in Postgres which adds complexity with no v1 gain).
-- subject_id is nullable: the wizard may save before subject exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS structure_mappings (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  subject_id TEXT,
  strategy_key TEXT NOT NULL,
  config_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS structure_mappings_connection_idx ON structure_mappings(connection_id);
CREATE INDEX IF NOT EXISTS structure_mappings_subject_idx ON structure_mappings(subject_id) WHERE subject_id IS NOT NULL;
