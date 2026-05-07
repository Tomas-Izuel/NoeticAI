import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/settings")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Settings</h1>
      <p>Placeholder — wired in Phase 7e.</p>
    </section>
  ),
});
