import { apiFetch } from "./client";

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadResult {
  syllabusId: string;
  version: number;
  jobId: string;
}

// Uses raw fetch (not apiFetch) so the browser can set the multipart boundary.
// apiFetch would inject `Content-Type: application/json`, which breaks FormData.
// Error handling mirrors apiFetch's pattern.
export async function uploadSyllabus(
  file: File,
  subjectName?: string,
): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file);
  if (subjectName) fd.append("subjectName", subjectName);

  const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const res = await fetch(`${BASE}/api/syllabus`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  const ct = res.headers.get("content-type") ?? "";
  const body: unknown = ct.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const msg =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `upload failed: ${res.status}`;
    throw new Error(msg);
  }

  return body as UploadResult;
}

// ─── Draft ────────────────────────────────────────────────────────────────────

export interface DraftConcept {
  id: string;
  unitId: string | null;
  order: number;
  name: string;
  learningObjective: string | null;
  syllabusExcerpt: string | null;
}

export interface DraftUnit {
  id: string;
  subjectId: string;
  order: number;
  name: string;
  weeksLabel: string | null;
  concepts: DraftConcept[];
}

export interface DraftSubject {
  id: string;
  name: string;
  course: string | null;
  term: string | null;
}

export interface DraftSyllabus {
  id: string;
  subjectId: string;
  version: number;
  status: string;
  pageCount: number | null;
  isActive: boolean;
  failureReason: string | null;
}

export interface CurriculumDraft {
  syllabus: DraftSyllabus;
  subject: DraftSubject;
  units: DraftUnit[];
}

export function getDraft(syllabusId: string): Promise<CurriculumDraft> {
  return apiFetch<CurriculumDraft>(`/api/curriculum/draft/${syllabusId}`);
}

// ─── Confirm ──────────────────────────────────────────────────────────────────

export interface ConfirmEdits {
  subject?: { name?: string };
  units?: Record<string, { name?: string }>;
  concepts?: Record<string, { name?: string; learningObjective?: string }>;
}

export interface ConfirmResult {
  subjectId: string;
  syllabusId: string;
  version: number;
}

export function confirmCurriculum(args: {
  syllabusId: string;
  edits?: ConfirmEdits;
}): Promise<ConfirmResult> {
  return apiFetch<ConfirmResult>("/api/curriculum/confirm", {
    method: "POST",
    body: JSON.stringify(args),
  });
}
