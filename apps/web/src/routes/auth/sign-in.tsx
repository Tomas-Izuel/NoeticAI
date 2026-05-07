import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "../../api/auth";

export const Route = createFileRoute("/auth/sign-in")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: authError } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message ?? "sign-in failed");
      return;
    }
    navigate({ to: redirect ?? "/" });
  }

  return (
    <section style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "…" : "Sign in"}
        </button>
        {error ? <p style={{ color: "crimson", margin: 0 }}>{error}</p> : null}
      </form>
      <p style={{ marginTop: 16 }}>
        No account? <Link to="/auth/sign-up">Sign up</Link>
      </p>
    </section>
  );
}
