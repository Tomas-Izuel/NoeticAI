import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <section style={{ padding: "2rem", maxWidth: 720 }}>
      <h1>NoeticAI · Phase 0</h1>
      <p>
        Foundation only. Sign in or sign up to reach the auth-guarded routes.
        The product screens are placeholders until later phases.
      </p>
      <ul style={{ marginTop: "1rem", lineHeight: 1.9 }}>
        <li><Link to="/auth/sign-in">Sign in</Link></li>
        <li><Link to="/auth/sign-up">Sign up</Link></li>
        <li><Link to="/onboarding">Onboarding (placeholder)</Link></li>
        <li><Link to="/bibliography" search={{ subjectId: undefined }}>Bibliography</Link></li>
        <li><Link to="/plan">Plan (placeholder)</Link></li>
        <li><Link to="/settings">Settings (placeholder)</Link></li>
        <li><Link to="/dev/health">Dev · Health</Link></li>
        <li><Link to="/dev/ingest">Dev · Ingest</Link></li>
        <li><Link to="/dev/retrieve">Dev · Retrieve</Link></li>
      </ul>
    </section>
  );
}
