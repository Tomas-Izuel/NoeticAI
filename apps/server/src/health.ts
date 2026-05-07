import { pool } from "./db";
import { redis } from "./redis/client";
import { queues } from "./queue";
import { llm, embed } from "./ai";
import { healthSkipBedrock } from "./env";

interface SubsystemResult {
  ok: boolean;
  latencyMs?: number;
  skipped?: boolean;
  error?: string;
  counts?: Record<string, number>;
}

interface HealthReport {
  status: "ok" | "degraded";
  subsystems: {
    db: SubsystemResult;
    redis: SubsystemResult;
    bedrockLlm: SubsystemResult;
    bedrockEmbed: SubsystemResult;
    bullmq: SubsystemResult;
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: true; latencyMs: number; value: T } | { ok: false; latencyMs: number; error: string }> {
  const start = performance.now();
  try {
    const value = await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start), value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: message };
  }
}

async function pingDb(): Promise<SubsystemResult> {
  const r = await timed(async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  });
  return r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, latencyMs: r.latencyMs, error: r.error };
}

async function pingRedis(): Promise<SubsystemResult> {
  const r = await timed(() => redis.ping());
  return r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, latencyMs: r.latencyMs, error: r.error };
}

async function pingBullMq(): Promise<SubsystemResult> {
  const r = await timed(() => queues.noop.getJobCounts());
  if (!r.ok) return { ok: false, latencyMs: r.latencyMs, error: r.error };
  return { ok: true, latencyMs: r.latencyMs, counts: r.value as Record<string, number> };
}

async function pingBedrockLlm(): Promise<SubsystemResult> {
  if (healthSkipBedrock) return { ok: true, skipped: true };
  const r = await timed(() =>
    llm.haiku({
      system: "Reply with the single lowercase word: ok",
      messages: [{ role: "user", content: [{ text: "ping" }] }],
      maxTokens: 4,
      temperature: 0,
    }),
  );
  return r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, latencyMs: r.latencyMs, error: r.error };
}

async function pingBedrockEmbed(): Promise<SubsystemResult> {
  if (healthSkipBedrock) return { ok: true, skipped: true };
  const r = await timed(() => embed.embed({ texts: ["health check"] }));
  return r.ok ? { ok: true, latencyMs: r.latencyMs } : { ok: false, latencyMs: r.latencyMs, error: r.error };
}

export async function healthReport(): Promise<HealthReport> {
  const [db, rds, llmRes, embRes, bull] = await Promise.all([
    pingDb(),
    pingRedis(),
    pingBedrockLlm(),
    pingBedrockEmbed(),
    pingBullMq(),
  ]);
  const allOk = [db, rds, llmRes, embRes, bull].every((s) => s.ok);
  return {
    status: allOk ? "ok" : "degraded",
    subsystems: {
      db,
      redis: rds,
      bedrockLlm: llmRes,
      bedrockEmbed: embRes,
      bullmq: bull,
    },
  };
}
