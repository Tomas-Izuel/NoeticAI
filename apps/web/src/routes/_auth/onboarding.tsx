import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/onboarding")({
  component: () => (
    <section style={{ padding: "2rem" }}>
      <h1>Onboarding</h1>
      <p>Placeholder — wired in Phase 2.</p>
    </section>
  ),
});
