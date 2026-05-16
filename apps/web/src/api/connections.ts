import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus = "active" | "revoked";

export interface Connection {
  id: string;
  source: string;
  workspaceName: string;
  workspaceIcon: string | null;
  status: ConnectionStatus;
  createdAt: string;
}

export interface ConnectionListResponse {
  connections: Connection[];
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useConnections() {
  return useQuery<ConnectionListResponse, Error>({
    queryKey: ["connections"],
    queryFn: () => apiFetch<ConnectionListResponse>("/api/connections"),
    staleTime: 30_000,
  });
}

export function useDisconnect(id: string) {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error>({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>(`/api/connections/${id}/disconnect`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });
}
