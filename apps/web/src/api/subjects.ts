import { apiFetch } from "./client";

export interface SubjectTotals {
  concepts: number;
  covered: number;
  partial: number;
  missing: number;
}

export interface Subject {
  id: string;
  name: string;
  course: string | null;
  term: string | null;
  glyph: string | null;
  totals: SubjectTotals;
}

export function getSubjects(): Promise<{ subjects: Subject[] }> {
  return apiFetch<{ subjects: Subject[] }>("/api/subjects");
}
