import {
  pgTable,
  text,
  timestamp,
  boolean,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Phase 6 schema — OAuth connections, CSRF states, and connector structure mappings.

// ---------------------------------------------------------------------------
// source_connections: one row per user × source × workspace.
// Stores sealed OAuth tokens; never stores plaintext secrets.
// lifecycle: active → revoked | error
// ---------------------------------------------------------------------------
export const sourceConnections = pgTable(
  "source_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // "notion" | "drive"
    workspaceId: text("workspace_id").notNull(),
    workspaceName: text("workspace_name").notNull(),
    workspaceIcon: text("workspace_icon"),
    botId: text("bot_id"),
    accessTokenSealed: text("access_token_sealed").notNull(),
    refreshTokenSealed: text("refresh_token_sealed"),
    tokenType: text("token_type").notNull().default("bearer"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text("scope"),
    // active | revoked | error
    status: text("status").notNull().default("active"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Only one active connection per (user, source, workspace).
    userSourceWorkspaceUq: unique("source_connections_user_source_workspace_uq").on(
      t.userId,
      t.source,
      t.workspaceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// oauth_states: short-lived CSRF nonces created at OAuth start, consumed on
// callback. Row must be deleted atomically on use to prevent replay.
// ---------------------------------------------------------------------------
export const oauthStates = pgTable(
  "oauth_states",
  {
    state: text("state").primaryKey(), // 32-byte base64url random
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    redirectAfter: text("redirect_after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    // Index so a future cleanup job (Phase 7+) can efficiently purge expired rows.
    expiresAtIdx: index("oauth_states_expires_at_idx").on(t.expiresAt),
  }),
);

// ---------------------------------------------------------------------------
// structure_mappings: a mapping links one connection to one subject via a
// named strategy. config_json holds strategy-specific validated JSON.
// Only one active mapping per (connection, subject) is allowed.
// ---------------------------------------------------------------------------
export const structureMappings = pgTable(
  "structure_mappings",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => sourceConnections.id, { onDelete: "cascade" }),
    // nullable: mapping may be created before subject exists (wizard saves before ingest)
    subjectId: text("subject_id"),
    strategyKey: text("strategy_key").notNull(),
    configJson: jsonb("config_json").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
