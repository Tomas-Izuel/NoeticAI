import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/bibliography")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Bibliography</h1>
      <p>Placeholder — wired in Phase 4.</p>
    </section>
  ),
});
