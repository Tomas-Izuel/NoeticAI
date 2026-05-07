import { createFileRoute, Outlet, redirect, Link } from "@tanstack/react-router";

// Auth-guarded layout. Wraps protected routes with the design's dashboard
// shell — which is a CSS grid with four named slots (topbar / nav / main /
// tray). All four classes must be present or pages render invisibly.

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

function AuthLayout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark">Episteme</span>
          <span className="topbar-tag">v0.0 · phase 1</span>
        </div>
        <nav className="topbar-bread" />
        <div className="topbar-right" />
      </header>

      <nav className="nav">
        {/* Phase 1 placeholder. Real nav rail wires up in Phase 6+. */}
        <div className="nav-section">
          <div className="nav-cap">Dev</div>
          <Link className="nav-row" to="/dev/health">Health</Link>
          <Link className="nav-row" to="/dev/ingest">Ingest</Link>
          <Link className="nav-row" to="/dev/retrieve">Retrieve</Link>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>

      <footer className="tray">
        <span className="tray-item">
          <span className="dot" /> Phase 1 · Ollama dev
        </span>
        <span className="spacer" />
      </footer>
    </div>
  );
}
