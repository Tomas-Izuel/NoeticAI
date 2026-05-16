import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient, mapAuthError } from "../../api/auth";

export const Route = createFileRoute("/auth/sign-up")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notionLoading, setNotionLoading] = useState(false);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const emailCallback = new URL(redirect ?? "/", origin).toString();
  // Strip query string off the inner redirect — the workspace-OAuth callback
  // always appends ?connectionId=…, so a stale one in `redirect` would
  // collide and produce a duplicated search param.
  const redirectPath = (redirect ?? "/onboarding").split("?")[0] || "/onboarding";
  const notionCallback = new URL(
    `/connect/start?source=notion&redirect=${encodeURIComponent(redirectPath)}`,
    origin,
  ).toString();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    setSubmitting(false);
    if (authError) {
      setError(mapAuthError(authError));
      return;
    }
    void navigate({ to: emailCallback });
  }

  async function onNotion() {
    setError(null);
    setNotionLoading(true);
    const { error: authError } = await authClient.signIn.social({
      provider: "notion",
      callbackURL: notionCallback,
    });
    if (authError) {
      setNotionLoading(false);
      setError(mapAuthError(authError));
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        background: "var(--canvas)",
      }}
    >
      <div className="fade-in" style={{ width: "100%", maxWidth: 420 }}>
        <Brand />

        <h1
          className="hh-1 serif"
          style={{ margin: "0 0 12px", letterSpacing: "-0.018em" }}
        >
          Empezá a aprender.{" "}
          <span className="italic t-muted">Creá tu cuenta.</span>
        </h1>
        <p className="t-sm t-muted" style={{ margin: "0 0 28px", lineHeight: 1.55 }}>
          Una cuenta para auditar lo que sabés y lo que te falta.
        </p>

        <form
          onSubmit={onSubmit}
          className="panel"
          style={{ padding: "22px 22px 24px", display: "grid", gap: 14 }}
        >
          <FieldLabel htmlFor="name" label="Nombre" />
          <input
            id="name"
            className="input"
            required
            autoFocus
            autoComplete="name"
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <FieldLabel htmlFor="email" label="Email" />
          <input
            id="email"
            className="input"
            type="email"
            required
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <FieldLabel htmlFor="password" label="Contraseña" />
          <input
            id="password"
            className="input"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span
            className="t-xs t-faint"
            style={{ marginTop: -8, marginLeft: 2 }}
          >
            Mínimo 8 caracteres
          </span>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={submitting || notionLoading}
            style={{ justifyContent: "center", width: "100%", marginTop: 4 }}
          >
            {submitting ? (
              <>
                <Spinner /> Creando cuenta…
              </>
            ) : (
              "Crear cuenta"
            )}
          </button>
        </form>

        <Divider label="o" />

        <div style={{ display: "grid", gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary btn-lg"
            disabled={notionLoading || submitting}
            onClick={() => void onNotion()}
            style={{ justifyContent: "center", width: "100%", gap: 10 }}
          >
            {notionLoading ? (
              <>
                <Spinner /> Redirigiendo a Notion…
              </>
            ) : (
              <>
                <NotionGlyph /> Continuar con Notion
              </>
            )}
          </button>

          <GoogleButtonComingSoon />
        </div>

        {error ? <ErrorBox message={error} /> : null}

        <p
          className="t-sm t-muted"
          style={{ marginTop: 24, textAlign: "center", lineHeight: 1.55 }}
        >
          ¿Ya tenés cuenta?{" "}
          <Link
            to="/auth/sign-in"
            search={redirect ? { redirect } : undefined}
            style={{ color: "var(--accent-soft)" }}
          >
            Iniciá sesión
          </Link>
        </p>

        <FootMark />
      </div>

      <style>{`
        @keyframes auth-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── Shared primitives ───────────────────────────────────────────────────────

function Brand() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        marginBottom: 32,
      }}
    >
      <span
        className="serif italic"
        style={{ fontSize: 22, letterSpacing: "-0.01em", color: "var(--fg)" }}
      >
        <span style={{ color: "var(--accent)" }}>E</span>pisteme
      </span>
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          color: "var(--fg-faint)",
          textTransform: "uppercase",
        }}
      >
        noeticai
      </span>
    </div>
  );
}

function FieldLabel({ htmlFor, label }: { htmlFor: string; label: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className="cap"
      style={{ fontSize: 10, letterSpacing: "0.16em", marginBottom: -8 }}
    >
      {label}
    </label>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "20px 0",
      }}
    >
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      <span className="cap-sm t-faint">{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        marginTop: 16,
        padding: "10px 14px",
        background: "var(--red-tint)",
        border: "1px solid var(--accent-deep)",
        borderRadius: 4,
        fontSize: 13,
        color: "var(--red-fg)",
        lineHeight: 1.5,
      }}
    >
      {message}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 13,
        height: 13,
        border: "1.5px solid var(--fg-whisper)",
        borderTopColor: "var(--accent-soft)",
        borderRadius: "50%",
        animation: "auth-spin 0.7s linear infinite",
        display: "inline-block",
      }}
    />
  );
}

function GoogleButtonComingSoon() {
  return (
    <button
      type="button"
      className="btn btn-secondary btn-lg"
      disabled
      title="Disponible próximamente"
      aria-disabled="true"
      style={{
        justifyContent: "center",
        width: "100%",
        gap: 10,
        opacity: 0.55,
        cursor: "not-allowed",
      }}
    >
      <GoogleGlyph />
      <span>Continuar con Google</span>
      <span
        className="cap-sm"
        style={{
          marginLeft: 4,
          padding: "2px 8px",
          background: "var(--accent-tint)",
          color: "var(--accent-soft)",
          borderRadius: 999,
          letterSpacing: "0.14em",
        }}
      >
        Pronto
      </span>
    </button>
  );
}

function NotionGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="2" width="10" height="12" rx="1.5" />
      <line x1="5.5" y1="5" x2="10.5" y2="5" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" />
      <line x1="5.5" y1="11" x2="9" y2="11" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5 v3 h3" />
    </svg>
  );
}

function FootMark() {
  return (
    <div
      className="t-xs t-faint mono"
      style={{
        marginTop: 40,
        textAlign: "center",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        fontSize: 9.5,
      }}
    >
      Read-only access · Tu data no se modifica
    </div>
  );
}
