import { apiFetch } from "./client";

export type SourceStatus =
  | "uploading"
  | "chunking"
  | "embedded"
  | "ready"
  | "failed"
  | "partial";

export type SourceKind = "pdf" | "url";

export interface SourceListItem {
  id: string;
  kind: SourceKind;
  title: string;
  author: string | null;
  year: number | null;
  status: SourceStatus;
  externalUrl: string | null;
  sourceFilename: string | null;
  pageCount: number | null;
  chunkCount: number;
  byteCount: number | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDetail {
  source: SourceListItem;
  chunks: Array<{
    position: number;
    chapterLabel: string | null;
    pagesLabel: string | null;
    textPreview: string;
    charCount: number;
  }>;
}

export interface RetrievalResult {
  query: string;
  modelId: string;
  results: Array<{
    id: string;
    sourceId: string;
    sourceTitle: string;
    position: number;
    pagesLabel: string | null;
    text: string;
    similarity: number;
    distance: number;
  }>;
}

export function getSources(subjectId: string): Promise<{ sources: SourceListItem[] }> {
  return apiFetch<{ sources: SourceListItem[] }>(
    `/api/sources?subjectId=${encodeURIComponent(subjectId)}`,
  );
}

export function getSource(sourceId: string): Promise<SourceDetail> {
  return apiFetch<SourceDetail>(`/api/sources/${encodeURIComponent(sourceId)}`);
}

export function uploadPdfSource(args: {
  subjectId: string;
  file: File;
  title?: string;
}): Promise<{ sourceId: string; jobId: string }> {
  const fd = new FormData();
  fd.set("subjectId", args.subjectId);
  fd.set("file", args.file);
  if (args.title) fd.set("title", args.title);
  // NOTE: do NOT set content-type — the browser fills in the multipart boundary.
  return apiFetch<{ sourceId: string; jobId: string }>("/api/sources", {
    method: "POST",
    body: fd,
  });
}

export function addUrlSource(args: {
  subjectId: string;
  url: string;
  title?: string;
}): Promise<{ sourceId: string; jobId: string }> {
  return apiFetch<{ sourceId: string; jobId: string }>("/api/sources", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function deleteSource(sourceId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/api/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
}

export function reindexSource(sourceId: string): Promise<{ sourceId: string; jobId: string }> {
  return apiFetch<{ sourceId: string; jobId: string }>(
    `/api/sources/${encodeURIComponent(sourceId)}/reindex`,
    { method: "POST" },
  );
}

export function runRetrieve(
  subjectId: string,
  q: string,
  k = 5,
): Promise<RetrievalResult> {
  const params = new URLSearchParams({ subjectId, q, k: String(k) });
  return apiFetch<RetrievalResult>(`/dev/retrieve-source?${params.toString()}`);
}
