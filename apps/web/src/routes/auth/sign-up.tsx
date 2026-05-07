import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "../../api/auth";

export const Route = createFileRoute("/auth/sign-up")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: authError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message ?? "sign-up failed");
      return;
    }
    navigate({ to: redirect ?? "/" });
  }

  return (
    <section style={{ maxWidth: 360, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign up</h1>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Name</span>
          <input
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "…" : "Sign up"}
        </button>
        {error ? <p style={{ color: "crimson", margin: 0 }}>{error}</p> : null}
      </form>
      <p style={{ marginTop: 16 }}>
        Have an account? <Link to="/auth/sign-in">Sign in</Link>
      </p>
    </section>
  );
}
