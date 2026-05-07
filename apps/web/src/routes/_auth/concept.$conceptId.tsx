import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/concept/$conceptId")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Concept</h1>
      <p>Placeholder — wired in Phase 5.</p>
    </section>
  ),
});
