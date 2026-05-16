import { randomBytes } from "node:crypto";
import { pool } from "../db";
import { seal } from "../crypto/secret-box";
import { env } from "../env";
import { NOTION_API_BASE, NOTION_API_VERSION } from "../connectors/notion/api";

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const STATE_TTL_MINUTES = 10;

// ---------------------------------------------------------------------------
// Notion token exchange response shape
// ---------------------------------------------------------------------------
export interface NotionTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  owner?: unknown;
  duplicated_template_id?: string | null;
  // Notion public integrations may include a refresh_token and expires_in.
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

// ---------------------------------------------------------------------------
// generateState: create a cryptographically random state nonce and persist
// it in oauth_states. Returns the raw state string.
// ---------------------------------------------------------------------------
export async function generateState(opts: {
  userId: string;
  source: string;
  redirectAfter?: string;
}): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000).toISOString();

  await pool.query(
    `INSERT INTO oauth_states (state, user_id, source, redirect_after, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, opts.userId, opts.source, opts.redirectAfter ?? null, expiresAt],
  );

  return state;
}

// ---------------------------------------------------------------------------
// buildNotionAuthorizeUrl: builds the Notion OAuth authorization URL.
// ---------------------------------------------------------------------------
export function buildNotionAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.NOTION_CLIENT_ID!,
    redirect_uri: env.NOTION_OAUTH_REDIRECT_URI!,
    response_type: "code",
    owner: "user",
    state,
  });
  return `${NOTION_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// consumeState: validate + delete the state row in one logical step.
// Returns the state row data on success, or null if invalid/expired.
// ---------------------------------------------------------------------------
interface OauthStateRow {
  user_id: string;
  source: string;
  redirect_after: string | null;
}

export async function consumeState(
  state: string,
  source: string,
): Promise<OauthStateRow | null> {
  // Delete and return in one query (atomic — no race between SELECT and DELETE).
  const rows = await pool.query<OauthStateRow & { expires_at: Date }>(
    `DELETE FROM oauth_states
     WHERE state = $1 AND source = $2 AND expires_at > NOW()
     RETURNING user_id, source, redirect_after, expires_at`,
    [state, source],
  );
  return rows.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// exchangeCode: exchange an authorization code for a Notion access token.
// ---------------------------------------------------------------------------
export async function exchangeCode(code: string): Promise<NotionTokenResponse> {
  const clientId = env.NOTION_CLIENT_ID!;
  const clientSecret = env.NOTION_CLIENT_SECRET!;
  const redirectUri = env.NOTION_OAUTH_REDIRECT_URI!;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${NOTION_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const body = (await res.json()) as NotionTokenResponse;

  if (!res.ok || body.error) {
    throw new Error(
      `Notion token exchange failed (${res.status}): ${body.error ?? res.statusText} — ${body.error_description ?? ""}`,
    );
  }

  return body;
}

// ---------------------------------------------------------------------------
// upsertConnection: upsert a source_connections row from a token response.
// Returns the connection id.
// ---------------------------------------------------------------------------
export async function upsertConnection(
  userId: string,
  token: NotionTokenResponse,
): Promise<string> {
  const id = crypto.randomUUID();
  const accessSealed = seal(token.access_token);
  const refreshSealed = token.refresh_token ? seal(token.refresh_token) : null;
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;

  // ON CONFLICT: if the same (user, source, workspace) already exists, update
  // the token fields and reactivate (e.g. user re-connected a revoked workspace).
  const rows = await pool.query<{ id: string }>(
    `INSERT INTO source_connections
       (id, user_id, source, workspace_id, workspace_name, workspace_icon,
        bot_id, access_token_sealed, refresh_token_sealed, token_type,
        expires_at, status, created_at, updated_at)
     VALUES ($1, $2, 'notion', $3, $4, $5, $6, $7, $8, $9, $10, 'active', NOW(), NOW())
     ON CONFLICT (user_id, source, workspace_id) DO UPDATE SET
       access_token_sealed = EXCLUDED.access_token_sealed,
       refresh_token_sealed = COALESCE(EXCLUDED.refresh_token_sealed, source_connections.refresh_token_sealed),
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       workspace_name = EXCLUDED.workspace_name,
       workspace_icon = EXCLUDED.workspace_icon,
       bot_id = EXCLUDED.bot_id,
       status = 'active',
       last_error = NULL,
       updated_at = NOW()
     RETURNING id`,
    [
      id,
      userId,
      token.workspace_id,
      token.workspace_name,
      token.workspace_icon ?? null,
      token.bot_id,
      accessSealed,
      refreshSealed,
      token.token_type ?? "bearer",
      expiresAt,
    ],
  );

  return rows.rows[0]!.id;
}
