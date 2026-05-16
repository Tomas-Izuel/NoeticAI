import { apiFetch } from "./client";

export type CompletionStatus =
  | "queued"
  | "running"
  | "pending"
  | "merged_locally"
  | "edited"
  | "rejected"
  | "null_no_grounding"
  | "failed";

export interface CompletionParagraph {
  text: string;
  sourceIds: string[]; // chunkIds
}

export interface CompletionLatestResponse {
  completion: {
    id: string;
    status: CompletionStatus;
    summary: string | null;
    paragraphs: CompletionParagraph[] | null;
    confidence: number | null;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
    guardFailureReason: string | null;
    failureReason: string | null;
    createdAt: string;
  } | null;
  citations: Record<
    string,
    {
      chunkId: string;
      sourceId: string;
      sourceTitle: string;
      sourceAuthor: string | null;
      sourceYear: number | null;
      chapterLabel: string | null;
      pagesLabel: string | null;
      similarity: number;
      paragraphIndex: number;
    }
  >;
}

export interface RequestCompletionResponse {
  completionId: string;
  // null when cached: true — the cache short-circuit skips job enqueue entirely.
  jobId: string | null;
  cached: boolean;
}

export interface ChunkDetailResponse {
  chunk: {
    id: string;
    sourceId: string;
    position: number;
    chapterLabel: string | null;
    pagesLabel: string | null;
    text: string;
    charCount: number;
  };
  source: {
    id: string;
    title: string;
    author: string | null;
    year: number | null;
  };
  surrounding: {
    previous: { id: string; position: number; text: string; pagesLabel: string | null } | null;
    next: { id: string; position: number; text: string; pagesLabel: string | null } | null;
  };
}

export function getCompletionLatest(conceptId: string): Promise<CompletionLatestResponse> {
  return apiFetch(`/api/concepts/${encodeURIComponent(conceptId)}/completions/latest`);
}

export function requestCompletion(conceptId: string): Promise<RequestCompletionResponse> {
  return apiFetch(`/api/concepts/${encodeURIComponent(conceptId)}/complete`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export interface CompletionEligibility {
  eligible: boolean;
  reason: "ok" | "no_sources_loaded" | "no_ready_sources" | "no_related_chunks";
  subjectSourcesTotal: number;
  subjectSourcesReady: number;
  candidateChunkCount: number;
  topSimilarity: number | null;
  similarityFloor: number;
  embedModelId: string;
  checkedAt: string;
}

export function getCompletionEligibility(conceptId: string): Promise<CompletionEligibility> {
  return apiFetch(`/api/concepts/${encodeURIComponent(conceptId)}/completion-eligibility`);
}

export function getChunk(sourceId: string, chunkId: string): Promise<ChunkDetailResponse> {
  return apiFetch(
    `/api/sources/${encodeURIComponent(sourceId)}/chunks/${encodeURIComponent(chunkId)}`,
  );
}
