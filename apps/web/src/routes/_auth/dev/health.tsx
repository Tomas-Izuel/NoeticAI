import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

interface Sub {
  ok: boolean;
  latencyMs?: number;
  skipped?: boolean;
  error?: string;
  counts?: Record<string, number>;
}

interface Health {
  status: "ok" | "degraded";
  subsystems: {
    db: Sub;
    redis: Sub;
    bedrockLlm: Sub;
    bedrockEmbed: Sub;
    bullmq: Sub;
  };
}

export const Route = createFileRoute("/_auth/dev/health")({
  component: HealthPage,
});

function Pill({ name, sub }: { name: string; sub: Sub }) {
  const color = sub.skipped ? "#999" : sub.ok ? "#1a8e3a" : "#c00";
  const right = sub.skipped
    ? "skipped"
    : sub.ok
      ? `${sub.latencyMs ?? "?"}ms`
      : (sub.error ?? "error");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        border: "1px solid #2a2a2a",
        borderRadius: 6,
        marginBottom: 8,
        background: "#0e0e0e",
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <strong style={{ minWidth: 140 }}>{name}</strong>
      <span style={{ color: "#aaa", fontSize: 13 }}>{right}</span>
      {sub.counts ? (
        <span style={{ marginLeft: "auto", color: "#888", fontSize: 12 }}>
          {Object.entries(sub.counts)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ")}
        </span>
      ) : null}
    </div>
  );
}

function HealthPage() {
  const { data, isLoading, error } = useQuery<Health, Error>({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/health", { credentials: "include" });
      const json = (await res.json()) as Health;
      // 503 from a degraded subsystem is still a successful read of the report.
      if (!res.ok && res.status !== 503) {
        throw new Error(`health request failed: ${res.status}`);
      }
      return json;
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <p style={{ padding: "2rem" }}>loading health…</p>;
  if (error)
    return (
      <p style={{ padding: "2rem", color: "crimson" }}>{error.message}</p>
    );
  if (!data) return null;

  return (
    <section style={{ maxWidth: 560, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Dev · Health</h1>
      <p>
        Overall: <strong>{data.status}</strong>
      </p>
      <Pill name="Postgres" sub={data.subsystems.db} />
      <Pill name="Redis" sub={data.subsystems.redis} />
      <Pill name="Bedrock LLM" sub={data.subsystems.bedrockLlm} />
      <Pill name="Bedrock Embed" sub={data.subsystems.bedrockEmbed} />
      <Pill name="BullMQ" sub={data.subsystems.bullmq} />
    </section>
  );
}
