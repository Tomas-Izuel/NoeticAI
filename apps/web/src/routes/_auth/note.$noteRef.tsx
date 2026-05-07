import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/note/$noteRef")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Note</h1>
      <p>Placeholder — wired in Phase 6.</p>
    </section>
  ),
});
