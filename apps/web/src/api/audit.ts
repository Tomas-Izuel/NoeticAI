import { apiFetch } from "./client";

// ── Types: mirror the server response shapes from §3.6. ──────────────────────

export type CoverageState = "green" | "amber" | "red";
export type ConceptVerdict = "engages" | "mentions" | "tangential" | "off-topic";

export interface AuditRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
}

export interface AuditConceptPreview {
  fragmentId: string;
  fragmentText: string;
  similarity: number;
  verdict: ConceptVerdict;
}

export interface AuditConcept {
  id: string;
  order: number;
  name: string;
  learningObjective: string | null;
  state: CoverageState;
  depth: number;
  mentions: number;
  sources: number;
  fragments: number;
  conflict: boolean;
  previews: AuditConceptPreview[];
}

export interface AuditUnit {
  id: string;
  order: number;
  name: string;
  weeksLabel: string | null;
  concepts: AuditConcept[];
}

export interface AuditTotals {
  concepts: number;
  covered: number;
  partial: number;
  missing: number;
}

export interface InFlightRun {
  id: string;
  status: "queued" | "running";
  startedAt: string;
}

export interface AuditLatest {
  run: AuditRunSummary | null;
  inFlightRun: InFlightRun | null;
  subject: {
    id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
  };
  totals: AuditTotals | null;
  units: AuditUnit[];
}

export interface AuditRunDetailFragment {
  fragmentId: string;
  fragmentText: string;
  noteId: string;
  noteTitle: string;
  similarity: number;
  verdict: ConceptVerdict;
}

export interface AuditRunDetailConcept {
  conceptId: string;
  conceptName: string;
  unitId: string | null;
  state: CoverageState;
  depth: number;
  mentions: number;
  sources: number;
  fragments: number;
  conflict: boolean;
  trace: { topFragments: AuditRunDetailFragment[] };
}

export interface AuditRunDetail {
  run: {
    id: string;
    subjectId: string;
    syllabusId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    thresholds: {
      greenDepth: number;
      amberDepth: number;
      minFragmentsForGreen: number;
    };
    models: { embed: string; haiku: string };
    failureReason: string | null;
    startedAt: string;
    finishedAt: string | null;
  };
  concepts?: AuditRunDetailConcept[];
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export interface RunAuditResponse {
  auditRunId: string;
  jobId: string | null;
  status?: "queued" | "running";
  alreadyRunning?: boolean;
}

export function startAuditRun(subjectId: string): Promise<RunAuditResponse> {
  return apiFetch<RunAuditResponse>("/api/audit/runs", {
    method: "POST",
    body: JSON.stringify({ subjectId }),
  });
}

export function getAuditLatest(subjectId: string): Promise<AuditLatest> {
  return apiFetch<AuditLatest>(`/api/subjects/${subjectId}/audit/latest`);
}

export function getAuditRun(runId: string, conceptId?: string): Promise<AuditRunDetail> {
  const qs = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : "";
  return apiFetch<AuditRunDetail>(`/api/audit/runs/${runId}${qs}`);
}
