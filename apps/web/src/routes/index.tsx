import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["server-health"],
    queryFn: async () => {
      const res = await fetch("/api/health");
      if (!res.ok) throw new Error("server unreachable");
      return res.json() as Promise<{ status: string }>;
    },
  });

  return (
    <section>
      <h1>NoeticAI · Web</h1>
      <p>TanStack Router + Query, talking to the Bun server via /api proxy.</p>
      <p>
        Server status:{" "}
        {isLoading ? "…" : error ? `error: ${error.message}` : data?.status}
      </p>
    </section>
  );
}
