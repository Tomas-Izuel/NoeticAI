import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useActiveSubject } from "../lib/useActiveSubject";
import { useTopGapConcept } from "../lib/useTopGapConcept";
import { useMe } from "../api/auth";
import { Topbar } from "../components/shell/Topbar";
import { NavRail } from "../components/shell/NavRail";
import { SystemTray } from "../components/shell/SystemTray";

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
  useEffect(() => {
    if (isLoading) return;
    if (subjects.length === 0 && !pathname.startsWith("/onboarding")) {
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
        <Outlet />
      </main>

      <SystemTray activeSubject={activeSubject} />
    </div>
  );
}
