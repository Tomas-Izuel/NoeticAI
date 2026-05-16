// Thin Notion API client. Does NOT depend on the official SDK so we keep the
// dep tree lean. Implements only what Phase 6 needs.

export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2022-06-28";

// Maximum retry wait (ms) when a 429 is received from Notion.
// Notion's Retry-After is typically 1–2s; we wait up to 5s before one retry.
const MAX_RETRY_WAIT_MS = 5_000;

export interface NotionApiError extends Error {
  status: number;
  code: string;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_API_VERSION,
    "Content-Type": "application/json",
  };
}

async function parseResponse<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(
      `Notion API ${res.status}: ${(body as { message?: string }).message ?? res.statusText}`,
    ) as NotionApiError;
    err.status = res.status;
    err.code = (body as { code?: string }).code ?? "unknown";
    throw err;
  }
  return body as T;
}

// notionFetch performs a single Notion API call with one 429 retry.
// Callers should NOT retry 401 — those surface immediately so the connection
// can be marked revoked.
export async function notionFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${NOTION_API_BASE}${path}`;
  const headers = { ...buildHeaders(token), ...(init.headers as Record<string, string> ?? {}) };

  const res = await fetch(url, { ...init, headers });

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = Math.min(
      retryAfter ? parseFloat(retryAfter) * 1000 : 1000,
      MAX_RETRY_WAIT_MS,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    const retryRes = await fetch(url, { ...init, headers });
    return parseResponse<T>(retryRes);
  }

  return parseResponse<T>(res);
}
