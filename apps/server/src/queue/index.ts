import { Queue, Worker, Job, type JobsOptions } from "bullmq";
import { redis } from "../redis/client";
import { runIngest, type IngestResult } from "../ingest/pipeline";
import {
  processSyllabusJob,
  type SyllabusExtractionResult,
} from "../syllabus/job";
import { processAuditJob, type AuditJobResult } from "../audit/job";

export interface IngestJobData {
  userId: string;
  source: string;
}

export interface SyllabusJobData {
  syllabusId: string;
  userId: string;
}

export interface AuditJobData {
  auditRunId: string;
}

export const queues = {
  noop: new Queue("noop", { connection: redis }),
  ingest: new Queue<IngestJobData, IngestResult>("ingest", {
    connection: redis,
  }),
  syllabus: new Queue<SyllabusJobData, SyllabusExtractionResult>("syllabus", {
    connection: redis,
  }),
  audit: new Queue<AuditJobData, AuditJobResult>("audit", {
    connection: redis,
  }),
};

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
    console.error(`[queue:ingest] job=${job?.id} failed:`, err.message);
  });

  // Concurrency=1: Opus calls are heavy and rare; serialising prevents
  // resource contention and keeps extraction costs predictable.
  // Error handling (DB status update) is done inside processSyllabusJob.
  const syllabusWorker = new Worker<SyllabusJobData, SyllabusExtractionResult>(
    "syllabus",
    async (job) => processSyllabusJob(job.data),
    { connection: redis, concurrency: 1 },
  );
  syllabusWorker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[queue:syllabus] worker error:", err.message);
  });
  syllabusWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[queue:syllabus] job=${job?.id} failed:`, err.message);
  });

  // Concurrency=1: audit runs are heavy (Haiku × 80 concepts) and rare.
  // Per-subject serialisation is implicit at concurrency=1; lift to 4 when
  // we split a dedicated worker process per prod-changes.md §7.
  // Error handling (DB status update) is done inside processAuditJob.
  const auditWorker = new Worker<AuditJobData, AuditJobResult>(
    "audit",
    async (job) => processAuditJob(job.data),
    {
      connection: redis,
      concurrency: 1,
    },
  );
  auditWorker.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[queue:audit] worker error:", err.message);
  });
  auditWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(`[queue:audit] job=${job?.id} failed:`, err.message);
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

export async function enqueueSyllabusExtraction(
  data: SyllabusJobData,
  opts?: JobsOptions,
): Promise<string> {
  const job = await queues.syllabus.add("syllabus:extract", data, opts);
  if (!job.id) throw new Error("BullMQ did not return a job id");
  return job.id;
}

export async function enqueueAuditRun(
  data: AuditJobData,
  opts?: JobsOptions,
): Promise<string> {
  const job = await queues.audit.add("audit:run", data, opts);
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
  // Probe all known queues in registration order.
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
      failedReason:
        state === "failed" ? (job.failedReason ?? undefined) : undefined,
      progress:
        typeof progress === "number" ||
        (typeof progress === "object" && progress !== null)
          ? progress
          : undefined,
    };
  }
  return null;
}
