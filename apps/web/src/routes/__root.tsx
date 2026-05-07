import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import type { QueryClient } from "@tanstack/react-query";

// Minimal Phase 0 shell — mirrors /design/shell.jsx class names so the design
// CSS applies. Subject switcher, breadcrumbs, search are wired in later phases.

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-mark">Episteme</span>
          <span className="topbar-tag">v0.0 · phase 0</span>
        </div>
        <nav className="topbar-bread" />
        <div className="topbar-right" />
      </header>
      <main>
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  );
}
