import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

export type JobState =
  | "completed"
  | "failed"
  | "active"
  | "delayed"
  | "waiting"
  | "waiting-children"
  | "prioritized"
  | "unknown";

export interface JobLookup<TResult = unknown> {
  id: string;
  queue: string;
  state: JobState;
  result?: TResult;
  failedReason?: string;
  progress?: number | object;
}

const TERMINAL: JobState[] = ["completed", "failed"];

// Polls GET /api/jobs/:id every interval (default 1s) until the job is in a
// terminal state. Mature version of the helper sketched in implementation.md
// Phase 1; reused by audit + completion + syllabus + source ingest in later
// phases.
export function useAsyncJob<TResult = unknown>(
  jobId: string | null,
  opts: { intervalMs?: number; enabled?: boolean } = {},
): UseQueryResult<JobLookup<TResult>, Error> {
  const intervalMs = opts.intervalMs ?? 1000;
  return useQuery<JobLookup<TResult>, Error>({
    queryKey: ["job", jobId],
    queryFn: () => apiFetch<JobLookup<TResult>>(`/api/jobs/${jobId}`),
    enabled: !!jobId && (opts.enabled ?? true),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return intervalMs;
      return TERMINAL.includes(data.state) ? false : intervalMs;
    },
    retry: false,
  });
}
