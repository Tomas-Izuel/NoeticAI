import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/audit/$subjectId")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Audit</h1>
      <p>Placeholder — wired in Phase 3.</p>
    </section>
  ),
});
