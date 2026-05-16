import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useActiveSubject } from "../lib/useActiveSubject";
import { useTopGapConcept } from "../lib/useTopGapConcept";
import { hasPlaceholderEmail, useMe } from "../api/auth";
import { Topbar } from "../components/shell/Topbar";
import { NavRail } from "../components/shell/NavRail";
import { SystemTray } from "../components/shell/SystemTray";

const NO_EMAIL_DISMISS_KEY = "noeticai:no-email-banner-dismissed";

// Auth-guarded layout — wraps all /_auth/* routes with the design shell.
// Four CSS grid slots: topbar / nav / main / tray.

export const Route = createFileRoute("/_auth")({
  beforeLoad: async ({ location }) => {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.status === 401) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
      });
    }
    if (!res.ok) {
      throw new Error(`auth check failed: ${res.status}`);
    }
  },
  component: AuthLayout,
});

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return (parts[0][0] ?? "?").toUpperCase();
  return ((parts[0][0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

function AuthLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const meQuery = useMe();
  const { activeSubjectId, activeSubject, setActiveSubjectId, subjects, isLoading } =
    useActiveSubject();
  const { conceptId: topGapConceptId } = useTopGapConcept(activeSubjectId);

  // Empty-state redirect: if queries resolved and no subjects, go to /onboarding.
  // Exempt /onboarding, /connect/*, /settings, and / (home shows its own empty state).
  useEffect(() => {
    if (isLoading) return;
    if (
      subjects.length === 0 &&
      pathname !== "/" &&
      !pathname.startsWith("/onboarding") &&
      !pathname.startsWith("/connect/") &&
      !pathname.startsWith("/settings")
    ) {
      void navigate({ to: "/onboarding" });
    }
  }, [isLoading, subjects.length, pathname, navigate]);

  const user =
    meQuery.data
      ? { initials: deriveInitials(meQuery.data.user.name) }
      : null;

  return (
    <div className="app">
      <Topbar
        subjects={subjects}
        activeSubject={activeSubject}
        setActiveSubjectId={setActiveSubjectId}
        user={user}
      />

      <NavRail
        activeSubjectId={activeSubjectId}
        activeSubject={activeSubject}
        topGapConceptId={topGapConceptId}
      />

      <main className="main">
        <PlaceholderEmailBanner email={meQuery.data?.user.email ?? null} />
        <Outlet />
      </main>

      <SystemTray activeSubject={activeSubject} />
    </div>
  );
}

function PlaceholderEmailBanner({ email }: { email: string | null }) {
  const show = hasPlaceholderEmail(email);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(NO_EMAIL_DISMISS_KEY) === "1";
  });

  if (!show || dismissed) return null;

  const handleDismiss = () => {
    try {
      window.sessionStorage.setItem(NO_EMAIL_DISMISS_KEY, "1");
    } catch {
      // sessionStorage unavailable — fall back to in-memory dismiss only.
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        margin: "12px 24px 0",
        background: "var(--amber-tint)",
        border: "1px solid var(--amber)",
        borderRadius: 4,
        color: "var(--amber-fg)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1 }}>
        Tu cuenta de Notion no compartió un email.{" "}
        <Link to="/settings" style={{ color: "var(--amber-fg)", textDecoration: "underline" }}>
          Configurá uno desde ajustes
        </Link>{" "}
        para recibir notificaciones.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Cerrar aviso"
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 4,
          color: "var(--amber-fg)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.7,
        }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="1.5" y1="1.5" x2="9.5" y2="9.5" />
          <line x1="9.5" y1="1.5" x2="1.5" y2="9.5" />
        </svg>
      </button>
    </div>
  );
}
