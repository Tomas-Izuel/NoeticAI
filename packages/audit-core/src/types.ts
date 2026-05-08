import type { VerdictState, ConceptFragmentVerdict } from "./verdict";

export interface Thresholds {
  // Phase 0–2 fields (Phase 2 used these names; preserved for back-compat).
  greenDepth: number;             // alias for greenSimilarity. default 0.78
  amberDepth: number;             // alias for amberSimilarity. default 0.55
  minFragmentsForGreen: number;   // alias for greenMinFragments. default 2
  // Phase 3 + Phase 5 fields (defaults shipped; usage gated to those phases).
  conflictMinFragments?: number;            // default 3 — Phase 7b
  hallucinationGuardSimilarity?: number;    // default 0.85 — Phase 5
}

export interface Concept {
  id: string;
  unitId: string;
  order: number;
  name: string;
  learningObjective?: string;
  syllabusExcerpt?: string;
  neighborhood?: string[]; // related concept ids
}

export interface MasteryScore {
  auditRunId: string;
  conceptId: string;
  state: VerdictState;
  depth: number;
  mentions: number;
  sources: number;
  fragments: number;
  conflict: boolean;
}

export interface Gap {
  id: string;
  conceptId: string;
  firstDetectedInRun: string;
  currentState: VerdictState;
  status: "open" | "dismissed" | "completed" | "snoozed";
}

export interface Citation {
  completionId: string;
  chunkId: string;
  paragraphIndex: number;
  similarity: number;
}

export interface Completion {
  id: string;
  gapId: string;
  auditRunId: string;
  status: "pending" | "merged_locally" | "edited" | "rejected";
  summary: string;
  paragraphs: Array<{ text: string; sourceIds: string[] }>;
  confidence: number;
  modelId: string;
  promptHash: string;
  createdAt: string;
}

export interface AuditRun {
  id: string;
  subjectId: string;
  startedAt: string;
  finishedAt?: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  thresholds: Thresholds;
  models: { opus?: string; sonnet?: string; haiku?: string; embed?: string };
}

export interface ConceptFragmentLink {
  auditRunId: string;
  conceptId: string;
  fragmentId: string;
  similarity: number;
  verdict: ConceptFragmentVerdict;
}
