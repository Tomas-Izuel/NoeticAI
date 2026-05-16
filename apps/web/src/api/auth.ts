import { createAuthClient } from "better-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
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

// Uses better-auth client signOut, then clears cached user/subject data.
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useCallback(async () => {
    await authClient.signOut();
    queryClient.removeQueries({ queryKey: ["me"] });
    queryClient.removeQueries({ queryKey: ["subjects"] });
    void navigate({ to: "/auth/sign-in" });
  }, [queryClient, navigate]);
}

// ---------------------------------------------------------------------------
// Placeholder-email detection
//
// When Notion sign-in succeeds but the user's workspace does not expose an
// email, the backend synthesizes notion-<id>@noeticai.local. The web app
// surfaces a banner asking the user to set a real email.
// ---------------------------------------------------------------------------
export function hasPlaceholderEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.endsWith("@noeticai.local");
}

// ---------------------------------------------------------------------------
// Error mapping — turns better-auth error codes/messages into copy the user
// can act on. Spanish, to match the /onboarding voice.
// ---------------------------------------------------------------------------
interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
  statusText?: string;
}

const SPANISH_BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email o contraseña incorrectos.",
  INVALID_PASSWORD: "Email o contraseña incorrectos.",
  USER_NOT_FOUND: "No existe una cuenta con ese email.",
  USER_ALREADY_EXISTS:
    "Ya existe una cuenta con ese email. Intentá iniciar sesión.",
  EMAIL_ALREADY_EXISTS:
    "Ya existe una cuenta con ese email. Intentá iniciar sesión.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
  PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
  INVALID_EMAIL: "El email no es válido.",
  OAUTH_ACCOUNT_NOT_LINKED:
    "Esa cuenta de Notion no está vinculada a ningún usuario. Iniciá sesión con email primero.",
  EMAIL_NOT_VERIFIED: "Tenés que verificar tu email antes de continuar.",
};

export function mapAuthError(err: unknown): string {
  if (!err) return "No pudimos completar el inicio de sesión. Intentá de nuevo.";
  const e = err as AuthErrorLike;

  if (e.code) {
    const key = e.code.toUpperCase();
    if (SPANISH_BY_CODE[key]) return SPANISH_BY_CODE[key];
  }

  if (typeof e.message === "string") {
    const upper = e.message.toUpperCase();
    for (const [code, copy] of Object.entries(SPANISH_BY_CODE)) {
      if (upper.includes(code)) return copy;
    }
    if (e.message.trim().length > 0 && e.message.length < 140) {
      return e.message;
    }
  }

  return "No pudimos completar el inicio de sesión. Intentá de nuevo.";
}
