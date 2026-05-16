import { Hono } from "hono";
import { auth } from "../auth";
import { env, notionOauthConfigured } from "../env";
import {
  generateState,
  buildNotionAuthorizeUrl,
  consumeState,
  exchangeCode,
  upsertConnection,
} from "./notion";

export const oauthRouter = new Hono();

const NOTION_NOT_CONFIGURED_BODY = {
  error: "notion_oauth_not_configured",
  message:
    "Notion OAuth is not configured on this server. " +
    "Set NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI.",
};

// ---------------------------------------------------------------------------
// GET /api/oauth/notion/start?redirect=/onboarding
//
// Returns { authorizeUrl } so the SPA can redirect the browser.
// Keeps the session cookie flow intact (no server-side redirect from here).
// ---------------------------------------------------------------------------
oauthRouter.get("/api/oauth/notion/start", async (c) => {
  if (!notionOauthConfigured()) {
    return c.json(NOTION_NOT_CONFIGURED_BODY, 503);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const redirectAfter = c.req.query("redirect") ?? undefined;

  const state = await generateState({
    userId: session.user.id,
    source: "notion",
    redirectAfter,
  });

  const authorizeUrl = buildNotionAuthorizeUrl(state);
  return c.json({ authorizeUrl });
});

// ---------------------------------------------------------------------------
// GET /api/oauth/notion/callback?code=…&state=…
//
// Browser-facing endpoint. On success: 302 to ${WEB_URL}/connect/done?connectionId=…
// On failure: 302 to ${WEB_URL}/connect/done?error=<short_code>
// ---------------------------------------------------------------------------
oauthRouter.get("/api/oauth/notion/callback", async (c) => {
  if (!notionOauthConfigured()) {
    // Redirect to error page rather than returning JSON — the browser hit this directly.
    return c.redirect(`${env.WEB_URL}/connect/done?error=notion_oauth_not_configured`);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!state || !code) {
    return c.redirect(`${env.WEB_URL}/connect/done?error=missing_params`);
  }

  // Validate and atomically consume the CSRF state.
  const stateRow = await consumeState(state, "notion");
  if (!stateRow) {
    // Expired, already used, or forged state — CSRF protection.
    return c.json({ error: "invalid_state" }, 400);
  }

  let connectionId: string;
  try {
    const token = await exchangeCode(code);
    connectionId = await upsertConnection(stateRow.user_id, token);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[oauth/notion] token exchange failed:", err);
    const destination = stateRow.redirect_after ?? `${env.WEB_URL}/connect/done`;
    const base = destination.startsWith("http") ? destination : `${env.WEB_URL}${destination}`;
    return c.redirect(`${base}?error=token_exchange_failed`);
  }

  // Build redirect destination. redirect_after may be a path like "/onboarding"
  // or a full URL — normalize to a full URL.
  const rawDest = stateRow.redirect_after ?? `${env.WEB_URL}/connect/done`;
  const destination = rawDest.startsWith("http") ? rawDest : `${env.WEB_URL}${rawDest}`;

  // Append connectionId separator correctly.
  const sep = destination.includes("?") ? "&" : "?";
  return c.redirect(`${destination}${sep}connectionId=${connectionId}`);
});
