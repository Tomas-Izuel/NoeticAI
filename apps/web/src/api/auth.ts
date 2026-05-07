import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";

// No baseURL override — better-auth defaults to window.location.origin
// in the browser, which is http://localhost:3000 (the web app). Requests
// like /api/auth/sign-up/email then go through the vite proxy → server.
// basePath defaults to "/api/auth" internally.
export const authClient = createAuthClient();

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
