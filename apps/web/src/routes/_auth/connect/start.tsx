import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { startNotionOAuth } from "../../../api/strategies";
import { useConnections } from "../../../api/connections";

// ─── Search params ────────────────────────────────────────────────────────────

const searchSchema = z.object({
  source: z.enum(["notion"]).catch("notion"),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_auth/connect/start")({
  validateSearch: searchSchema,
  component: ConnectStartPage,
});

// ─── Component ────────────────────────────────────────────────────────────────

function ConnectStartPage() {
  const { source, redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // The OAuth callback appends ?connectionId=… so the inner redirect must not
  // already carry one (otherwise we get a duplicated search param and the
  // /connect/done validateSearch Zod schema fails).
  const redirectAfter = (redirect ?? "/connect/done").split("?")[0] || "/connect/done";

  // When this route is reached as part of the chained sign-in flow
  // (callbackURL=/connect/start?source=notion), returning users may already
  // have an active Notion connection. Skip the OAuth round-trip and bounce
  // them straight to `redirect` so the second Notion screen never appears.
  const connections = useConnections();
  const hasActiveNotion = (connections.data?.connections ?? []).some(
    (c) => c.source === "notion" && c.status === "active",
  );

  const triggerOAuth = async () => {
    setError(null);
    setRedirecting(true);
    try {
      await startNotionOAuth(redirectAfter);
      // startNotionOAuth redirects window.location — execution stops here on success
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : "OAuth start failed.");
    }
  };

  useEffect(() => {
    if (source !== "notion") return;
    if (connections.isLoading) return;
    if (hasActiveNotion) {
      // Already connected — go straight to the redirect target.
      const target = redirectAfter.startsWith("/") ? redirectAfter : `/${redirectAfter}`;
      window.location.href = target;
      return;
    }
    void triggerOAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.isLoading, hasActiveNotion]);

  // ─── Notion not configured error panel ───────────────────────────────────

  if (error) {
    return (
      <div
        style={{
          maxWidth: 600,
          margin: "80px auto",
          padding: "0 32px",
        }}
      >
        <div className="panel" style={{ padding: "32px 36px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "var(--red-tint)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="var(--red-fg)"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="8" cy="8" r="6.5" />
                <line x1="8" y1="5" x2="8" y2="8.5" />
                <circle cx="8" cy="11" r="0.8" fill="var(--red-fg)" stroke="none" />
              </svg>
            </div>
            <h1
              className="hh-3 serif"
              style={{ margin: 0, fontSize: 18, fontWeight: 500 }}
            >
              Notion not configured
            </h1>
          </div>

          <p className="t-sm" style={{ marginBottom: 20, lineHeight: 1.6 }}>
            The server can&apos;t start the OAuth flow because the Notion
            integration credentials are missing. Add these environment
            variables to{" "}
            <code className="mono" style={{ fontSize: 12 }}>
              apps/server/.env
            </code>
            :
          </p>

          <div
            className="panel"
            style={{
              padding: "14px 16px",
              background: "var(--elevated)",
              marginBottom: 20,
            }}
          >
            <pre
              className="mono t-sm"
              style={{
                margin: 0,
                lineHeight: 1.7,
                fontSize: 12,
                color: "var(--fg)",
              }}
            >
              {`NOTION_CLIENT_ID=your_client_id
NOTION_CLIENT_SECRET=your_client_secret
NOTION_OAUTH_REDIRECT_URI=http://localhost:8080/api/oauth/notion/callback`}
            </pre>
          </div>

          <p className="t-sm t-muted" style={{ marginBottom: 24, lineHeight: 1.6 }}>
            Create a Public Notion integration at{" "}
            <a
              href="https://www.notion.so/my-integrations"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent-soft)" }}
            >
              notion.so/my-integrations
            </a>
            . Set the redirect URI as shown above, then copy the Client ID and
            Secret here.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={() => void triggerOAuth()}
            >
              Retry
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void navigate({ to: "/onboarding" })}
            >
              Back to onboarding
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Redirecting state (shown briefly before window.location changes) ─────

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "120px auto",
        padding: "0 32px",
        textAlign: "center",
      }}
    >
      {redirecting ? (
        <>
          <div
            style={{
              width: 40,
              height: 40,
              border: "2px solid var(--fg-whisper)",
              borderTopColor: "var(--accent-soft)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 20px",
            }}
            aria-hidden="true"
          />
          <p className="t-sm t-muted">Redirecting to Notion…</p>
          <noscript>
            <button
              className="btn btn-primary"
              onClick={() => void triggerOAuth()}
            >
              Connect Notion
            </button>
          </noscript>
        </>
      ) : (
        <button
          className="btn btn-primary"
          onClick={() => void triggerOAuth()}
        >
          Connect Notion
        </button>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
