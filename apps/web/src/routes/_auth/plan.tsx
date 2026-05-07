import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/plan")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Plan</h1>
      <p>Placeholder — wired in Phase 7f.</p>
    </section>
  ),
});
