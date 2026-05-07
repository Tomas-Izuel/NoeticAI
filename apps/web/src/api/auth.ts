import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";

export const authClient = createAuthClient({ baseURL: "/api/auth" });

export interface Me {
  user: { id: string; email: string; name: string };
}

export function useMe() {
  return useQuery<Me, ApiError>({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/me"),
    retry: false,
  });
}
