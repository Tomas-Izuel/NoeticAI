import { pool } from "../db";
import { seal, open } from "../crypto/secret-box";
import { env } from "../env";
import { NOTION_API_BASE, NOTION_API_VERSION } from "./notion/api";

// ---------------------------------------------------------------------------
// Row shapes returned from raw pg queries
// ---------------------------------------------------------------------------

export interface ConnectionRow {
  id: string;
  user_id: string;
  source: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  bot_id: string | null;
  access_token_sealed: string;
  refresh_token_sealed: string | null;
  token_type: string;
  expires_at: Date | null;
  scope: string | null;
  status: string;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MappingRow {
  id: string;
  connection_id: string;
  subject_id: string | null;
  strategy_key: string;
  config_json: unknown;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ActiveConnection {
  row: ConnectionRow;
  // Decrypted, refreshed-if-needed access token.
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

interface NotionTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string;
  workspace_icon?: string;
  error?: string;
}

// Refresh the Notion access token for a connection if it is close to expiry.
// Returns the refreshed token, or null if the refresh fails (connection is
// marked revoked in that case).
export async function refreshNotionToken(connectionId: string): Promise<string | null> {
  const rows = await pool.query<ConnectionRow>(
    `SELECT * FROM source_connections WHERE id = $1`,
    [connectionId],
  );
  const conn = rows.rows[0];
  if (!conn) return null;
  if (!conn.refresh_token_sealed) return null;
  if (conn.status !== "active") return null;

  const refreshToken = open(conn.refresh_token_sealed);

  const clientId = env.NOTION_CLIENT_ID;
  const clientSecret = env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let body: NotionTokenResponse;
  try {
    const res = await fetch(`${NOTION_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    body = (await res.json()) as NotionTokenResponse;

    if (!res.ok || body.error) {
      // Treat 401 / invalid_grant as permanent revocation.
      await pool.query(
        `UPDATE source_connections
         SET status = 'revoked', last_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [body.error ?? `http_${res.status}`, connectionId],
      );
      return null;
    }
  } catch (err) {
    // Network error — don't revoke, just return null and let the caller fail.
    // eslint-disable-next-line no-console
    console.error("[connectors/service] refresh token network error:", err);
    return null;
  }

  const newAccessSealed = seal(body.access_token);
  const newRefreshSealed = body.refresh_token ? seal(body.refresh_token) : conn.refresh_token_sealed;

  const newExpiresAt =
    body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : null;

  await pool.query(
    `UPDATE source_connections
     SET access_token_sealed = $1,
         refresh_token_sealed = $2,
         expires_at = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [newAccessSealed, newRefreshSealed, newExpiresAt, connectionId],
  );

  return body.access_token;
}

// ---------------------------------------------------------------------------
// getActiveConnection
// Fetches the active connection for a user + source, decrypts the token,
// and refreshes it if it is within 60 seconds of expiry.
// ---------------------------------------------------------------------------

export async function getActiveConnection(
  userId: string,
  source: string,
): Promise<ActiveConnection | null> {
  const rows = await pool.query<ConnectionRow>(
    `SELECT * FROM source_connections
     WHERE user_id = $1 AND source = $2 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, source],
  );
  const conn = rows.rows[0];
  if (!conn) return null;

  // Token refresh: if expires_at is set and within 60s, attempt refresh.
  if (conn.expires_at !== null && conn.refresh_token_sealed) {
    const secsUntilExpiry = (conn.expires_at.getTime() - Date.now()) / 1000;
    if (secsUntilExpiry < 60) {
      const refreshed = await refreshNotionToken(conn.id);
      if (refreshed !== null) {
        return { row: conn, accessToken: refreshed };
      }
      // Refresh failed — connection now revoked, return null.
      return null;
    }
  }

  const accessToken = open(conn.access_token_sealed);
  return { row: conn, accessToken };
}

// ---------------------------------------------------------------------------
// getActiveMapping
// Returns the active structure_mapping for a connection, optionally filtered
// by subjectId.
// ---------------------------------------------------------------------------

export async function getActiveMapping(
  connectionId: string,
  subjectId?: string,
): Promise<MappingRow | null> {
  // When a subjectId is given, prefer a subject-specific mapping but fall back
  // to a connection-wide mapping (subject_id IS NULL). The wizard creates
  // mappings with subject_id = NULL before subjects exist, so a strict
  // subject_id = $2 filter would never match.
  if (subjectId) {
    const rows = await pool.query<MappingRow>(
      `SELECT * FROM structure_mappings
       WHERE connection_id = $1
         AND is_active = TRUE
         AND (subject_id = $2 OR subject_id IS NULL)
       ORDER BY (subject_id = $2) DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [connectionId, subjectId],
    );
    return rows.rows[0] ?? null;
  }

  const rows = await pool.query<MappingRow>(
    `SELECT * FROM structure_mappings
     WHERE connection_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC
     LIMIT 1`,
    [connectionId],
  );
  return rows.rows[0] ?? null;
}
