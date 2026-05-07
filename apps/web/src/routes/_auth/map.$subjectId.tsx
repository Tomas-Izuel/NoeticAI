import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/map/$subjectId")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Map</h1>
      <p>Placeholder — wired in Phase 7d.</p>
    </section>
  ),
});
