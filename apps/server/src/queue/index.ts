import { Queue, Worker, Job, type JobsOptions } from "bullmq";
import { redis } from "../redis/client";
import { runIngest, type IngestResult } from "../ingest/pipeline";

export const queues = {
  noop: new Queue("noop", { connection: redis }),
  ingest: new Queue<IngestJobData, IngestResult>("ingest", { connection: redis }),
};

export interface IngestJobData {
  userId: string;
  source: string;
}

let workersStarted = false;

export function startWorkers(): void {
  if (workersStarted) return;
  workersStarted = true;

  const noopWorker = new Worker(
    "noop",
    async (job) => {
      // eslint-disable-next-line no-console
      console.log(`[queue:noop] processed job=${job.id} name=${job.name}`);
      return { ok: true };
    },
    { connection: redis },
  );
  noopWorker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[queue:noop] worker error:", err.message);
  });

  // Concurrency=2 caps Cohere quota usage during fixture ingest (per
  // implementation.md Phase 1 risk note).
  const ingestWorker = new Worker<IngestJobData, IngestResult>(
    "ingest",
    async (job) => runIngest(job.data),
    { connection: redis, concurrency: 2 },
  );
  ingestWorker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[queue:ingest] worker error:", err.message);
  });
  ingestWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[queue:ingest] job=${job?.id} failed:`,
      err.message,
    );
  });
}

export async function enqueueIngest(
  data: IngestJobData,
  opts?: JobsOptions,
): Promise<string> {
  const job = await queues.ingest.add("ingest", data, opts);
  if (!job.id) throw new Error("BullMQ did not return a job id");
  return job.id;
}

export type JobState =
  | "completed"
  | "failed"
  | "active"
  | "delayed"
  | "waiting"
  | "waiting-children"
  | "prioritized"
  | "unknown";

export interface JobLookup {
  id: string;
  queue: string;
  state: JobState;
  result?: unknown;
  failedReason?: string;
  progress?: number | object;
}

export async function lookupJob(jobId: string): Promise<JobLookup | null> {
  // Probe known queues. For Phase 1 only "ingest" matters; "noop" is here so
  // future queues drop in without changing the API contract.
  for (const [name, queue] of Object.entries(queues)) {
    const job = await Job.fromId(queue, jobId);
    if (!job) continue;
    const state = (await job.getState()) as JobState;
    const progress = job.progress;
    return {
      id: jobId,
      queue: name,
      state,
      result: state === "completed" ? job.returnvalue : undefined,
      failedReason: state === "failed" ? (job.failedReason ?? undefined) : undefined,
      progress:
        typeof progress === "number" || (typeof progress === "object" && progress !== null)
          ? progress
          : undefined,
    };
  }
  return null;
}
