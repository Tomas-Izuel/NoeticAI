import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateMappingArgs {
  strategyKey: string;
  config: Record<string, string>;
}

// Updated: no longer returns subjectId; server now returns availableSubjectsCount
export interface CreateMappingResult {
  mappingId: string;
  availableSubjectsCount: number;
}

export interface ActiveMapping {
  id: string;
  strategyKey: string;
  configJson: Record<string, unknown>;
  subjectId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActiveMappingResponse {
  mapping: ActiveMapping | null;
}

// ─── Available subjects ───────────────────────────────────────────────────────

export interface AvailableSubject {
  externalId: string;
  name: string;
  course?: string;
  term?: string;
  glyph?: string;
  tracked: boolean;
  subjectId?: string;
}

export interface AvailableSubjectsResponse {
  subjects: AvailableSubject[];
}

// ─── Sync subjects ────────────────────────────────────────────────────────────

export interface SyncSubjectsArgs {
  externalIds: string[];
  kickIngest: boolean;
}

export interface SyncSubjectsResult {
  added: string[];
  removed: string[];
  kept: string[];
  jobs: Array<{ subjectId: string; jobId: string }>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useCreateMapping(connectionId: string | null) {
  const qc = useQueryClient();
  return useMutation<CreateMappingResult, Error, CreateMappingArgs>({
    mutationFn: (args) =>
      apiFetch<CreateMappingResult>(
        `/api/connections/${connectionId}/mappings`,
        {
          method: "POST",
          body: JSON.stringify(args),
        },
      ),
    onSuccess: () => {
      // Invalidate so the connections list + active mapping refresh
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}

export function useActiveMapping(connectionId: string | null) {
  return useQuery<ActiveMappingResponse, Error>({
    queryKey: ["connections", connectionId, "mappings", "active"],
    queryFn: () =>
      apiFetch<ActiveMappingResponse>(
        `/api/connections/${connectionId}/mappings/active`,
      ),
    enabled: !!connectionId,
    staleTime: 30_000,
  });
}

export function useAvailableSubjects(
  connectionId: string | null,
  mappingId: string | null,
) {
  return useQuery<AvailableSubjectsResponse, Error>({
    queryKey: ["connections", connectionId, "available-subjects", mappingId],
    queryFn: () =>
      apiFetch<AvailableSubjectsResponse>(
        `/api/connections/${connectionId}/mappings/${mappingId}/available-subjects`,
      ),
    enabled: !!connectionId && !!mappingId,
    staleTime: 30_000,
  });
}

export function useSyncSubjects(
  connectionId: string | null,
  mappingId: string | null,
) {
  const qc = useQueryClient();
  return useMutation<SyncSubjectsResult, Error, SyncSubjectsArgs>({
    mutationFn: (args) =>
      apiFetch<SyncSubjectsResult>(
        `/api/connections/${connectionId}/mappings/${mappingId}/subjects/sync`,
        {
          method: "POST",
          body: JSON.stringify(args),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: [
          "connections",
          connectionId,
          "available-subjects",
          mappingId,
        ],
      });
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["subjects"] });
    },
  });
}
