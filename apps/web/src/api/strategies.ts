import { useQuery } from "@tanstack/react-query";
import { apiFetch, ApiError } from "./client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotionPropertyType =
  | "title"
  | "rich_text"
  | "select"
  | "status"
  | "multi_select"
  | "relation"
  | "number"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "formula"
  | "rollup"
  | "people"
  | "files"
  | "created_time"
  | "created_by"
  | "last_edited_time"
  | "last_edited_by";

// Over-the-wire discriminated union of config field types — matches
// SerializedField on the server.
export type SerializedField =
  | { kind: "text"; label: string; required: boolean; default?: string; help?: string }
  | { kind: "database"; label: string; required: boolean; help?: string }
  | { kind: "page"; label: string; required: boolean; help?: string }
  | {
      kind: "property";
      label: string;
      required: boolean;
      dependsOn: string;
      propertyTypes: NotionPropertyType[];
      default?: string;
      help?: string;
    }
  | {
      kind: "select-option";
      label: string;
      required: boolean;
      dependsOnDatabase: string;
      dependsOnProperty: string;
      default?: string;
      help?: string;
    }
  | {
      kind: "enum";
      label: string;
      required: boolean;
      options: { value: string; label: string; description?: string }[];
      default?: string;
      help?: string;
    };

// Legacy alias kept for any internal code that still references FieldDescriptor.
// New code should use SerializedField directly.
export type FieldDescriptor = SerializedField;

export interface StrategyDescriptor {
  key: string;
  source: string;
  label: string;
  description: string;
  configSchema: Record<string, SerializedField>;
}

export interface StrategiesResponse {
  strategies: StrategyDescriptor[];
}

// ─── Discovery response (updated shape) ──────────────────────────────────────

export interface NotionResourceIcon {
  kind: "emoji" | "url";
  value: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  icon: NotionResourceIcon | null;
}

export interface NotionPage {
  id: string;
  title: string;
  icon: NotionResourceIcon | null;
}

export interface DiscoveryPayload {
  databases: NotionDatabase[];
  pages: NotionPage[];
  suggestedConfig: Record<string, string>;
}

// ─── Database schema endpoint ─────────────────────────────────────────────────

export interface DatabaseProperty {
  name: string;
  type: NotionPropertyType;
}

export interface DatabaseSchemaResponse {
  properties: DatabaseProperty[];
}

// ─── Property options endpoint ────────────────────────────────────────────────

export interface PropertyOption {
  value: string;
  label: string;
  color?: string;
}

export interface PropertyOptionsResponse {
  options: PropertyOption[];
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useStrategies(connectionId: string | null) {
  return useQuery<StrategiesResponse, Error>({
    queryKey: ["connections", connectionId, "strategies"],
    queryFn: () =>
      apiFetch<StrategiesResponse>(
        `/api/connections/${connectionId}/strategies`,
      ),
    enabled: !!connectionId,
    staleTime: 60_000,
  });
}

export function useDiscovery(
  connectionId: string | null,
  strategyKey: string | null,
) {
  return useQuery<DiscoveryPayload, Error>({
    queryKey: ["connections", connectionId, "discovery", strategyKey],
    queryFn: () =>
      apiFetch<DiscoveryPayload>(
        `/api/connections/${connectionId}/strategies/${strategyKey}/discovery`,
      ),
    enabled: !!connectionId && !!strategyKey,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useDatabaseSchema(
  connectionId: string | null,
  dbId: string | null,
) {
  return useQuery<DatabaseSchemaResponse, Error>({
    queryKey: ["connections", connectionId, "databases", dbId, "schema"],
    queryFn: () =>
      apiFetch<DatabaseSchemaResponse>(
        `/api/connections/${connectionId}/databases/${dbId}/schema`,
      ),
    enabled: !!connectionId && !!dbId,
    staleTime: 5 * 60_000,
  });
}

export function usePropertyOptions(
  connectionId: string | null,
  dbId: string | null,
  propName: string | null,
) {
  return useQuery<PropertyOptionsResponse, Error>({
    queryKey: [
      "connections",
      connectionId,
      "databases",
      dbId,
      "properties",
      propName,
      "options",
    ],
    queryFn: () =>
      apiFetch<PropertyOptionsResponse>(
        `/api/connections/${connectionId}/databases/${dbId}/properties/${encodeURIComponent(propName!)}/options`,
      ),
    enabled: !!connectionId && !!dbId && !!propName,
    staleTime: 5 * 60_000,
  });
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────

interface NotionStartResponse {
  authorizeUrl: string;
}

interface NotionNotConfiguredResponse {
  error: "notion_oauth_not_configured";
  message: string;
}

// Fetches the Notion OAuth start URL and redirects the browser there.
// On 503 (not configured), throws an Error with the server's message so
// the caller can surface a setup-instruction panel.
export async function startNotionOAuth(redirect: string): Promise<void> {
  const url =
    `/api/oauth/notion/start?redirect=${encodeURIComponent(redirect)}`;

  // Use raw fetch here — we need to inspect the status before acting.
  const res = await fetch(url, { credentials: "include" });
  const ct = res.headers.get("content-type") ?? "";
  const body: unknown = ct.includes("application/json")
    ? await res.json()
    : await res.text();

  if (res.status === 503) {
    const typed = body as NotionNotConfiguredResponse;
    throw new Error(typed.message ?? "Notion OAuth is not configured.");
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      body,
      typeof body === "string" ? body : "OAuth start failed.",
    );
  }

  const { authorizeUrl } = body as NotionStartResponse;
  window.location.href = authorizeUrl;
}
