import { apiFetch } from "./client";

export interface ConceptDetail {
  id: string;
  name: string;
  learningObjective: string | null;
  syllabusExcerpt: string | null;
  neighborhood: string[] | null;
  // null when the concept has no unit (concepts.unit_id is nullable per the curriculum schema).
  unit: { id: string; name: string; order: number; weeksLabel: string | null } | null;
  subject: { id: string; name: string; course: string | null };
  // Most-recent open-gap audit run (for trace step queries).
  latestRun: { id: string } | null;
}

export function getConcept(conceptId: string): Promise<{ concept: ConceptDetail }> {
  return apiFetch(`/api/concepts/${encodeURIComponent(conceptId)}`);
}
