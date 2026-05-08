import { apiFetch } from "./client";

export interface Subject {
  id: string;
  name: string;
  course: string | null;
}

export function getSubjects(): Promise<{ subjects: Subject[] }> {
  return apiFetch<{ subjects: Subject[] }>("/api/subjects");
}
