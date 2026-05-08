export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Only tag string bodies as JSON. FormData / Blob / URLSearchParams must let
  // the browser set their own content-type (and, for FormData, the boundary).
  if (
    typeof init?.body === "string" &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  const ct = res.headers.get("content-type") ?? "";
  const body: unknown = ct.includes("application/json")
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed: ${res.status}`;
    throw new ApiError(res.status, body, msg);
  }
  return body as T;
}
