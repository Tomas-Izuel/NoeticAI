import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TriggerIngestResult {
  jobId: string;
  source: string;
  queue: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useTriggerIngest(subjectId: string | null) {
  return useMutation<TriggerIngestResult, Error>({
    mutationFn: () =>
      apiFetch<TriggerIngestResult>(
        `/api/subjects/${subjectId}/ingest`,
        { method: "POST" },
      ),
    // Intentionally no invalidation here — the caller uses useAsyncJob to
    // poll for completion, and navigates away once the job finishes.
  });
}
