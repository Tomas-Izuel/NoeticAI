import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { AuditConcept } from "../../api/audit";
import { getAuditLatest, startAuditRun } from "../../api/audit";
import type { JobLookup } from "../../lib/useAsyncJob";
import { useAsyncJob } from "../../lib/useAsyncJob";
import { AuditHeader } from "../../screens/audit/AuditHeader";
import { AuditSkeleton } from "../../screens/audit/AuditSkeleton";
import { ConceptDrawer } from "../../screens/audit/ConceptDrawer";
import { EmptyAuditState } from "../../screens/audit/EmptyAuditState";
import { FilterRow } from "../../screens/audit/FilterRow";
import type { Filter } from "../../screens/audit/FilterRow";
import { UnitBlock } from "../../screens/audit/UnitBlock";

export const Route = createFileRoute("/_auth/audit/$subjectId")({
  component: AuditScreenRoute,
});

// BullMQ job result shape from audit worker
interface AuditJobResult {
  auditRunId: string;
  scoredConcepts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
}

const RUNNING_STATES = new Set(["active", "waiting", "waiting-children", "delayed", "prioritized"]);

function AuditScreenRoute() {
  const { subjectId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // ── 1. Latest audit data — refetch every 3s while a run is in flight so
  // the UI catches the transition from running → succeeded after a page
  // reload (when we no longer have a BullMQ jobId to poll).
  const latestQ = useQuery({
    queryKey: ["audit", "latest", subjectId],
    queryFn: () => getAuditLatest(subjectId),
    staleTime: 30 * 1000,
    refetchInterval: (q) => (q.state.data?.inFlightRun ? 3000 : false),
  });

  // ── 2. Run-audit mutation → captures jobId (may be null when the server
  // returns an already-in-flight run; treat that as a no-op).
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const runMutation = useMutation({
    mutationFn: () => startAuditRun(subjectId),
    onSuccess: (res) => {
      if (res.jobId) setActiveJobId(res.jobId);
      // If alreadyRunning, the latest-query refetchInterval picks it up.
      void qc.invalidateQueries({ queryKey: ["audit", "latest", subjectId] });
    },
  });

  // ── 3. Poll job until terminal ────────────────────────────────────────────
  const jobQ = useAsyncJob<AuditJobResult>(activeJobId, { intervalMs: 1500 });

  useEffect(() => {
    if (!jobQ.data) return;
    if (jobQ.data.state === "completed") {
      void qc.invalidateQueries({ queryKey: ["audit", "latest", subjectId] });
      setActiveJobId(null);
    }
    // On "failed", leave activeJobId set so the failure UI renders.
    // User clicks retry (which calls runMutation.mutate) to clear.
  }, [jobQ.data, qc, subjectId]);

  // ── 4. Filters ────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState<Filter>("all");

  // ── 5. Drawer state ───────────────────────────────────────────────────────
  const [activeConcept, setActiveConcept] = useState<AuditConcept | null>(null);

  // ── 6. Derived filtered units ─────────────────────────────────────────────
  const filteredUnits = useMemo(() => {
    if (!latestQ.data) return [];
    return latestQ.data.units
      .map((u) => ({
        ...u,
        concepts:
          filter === "all" ? u.concepts : u.concepts.filter((c) => c.state === filter),
      }))
      .filter((u) => u.concepts.length > 0);
  }, [latestQ.data, filter]);

  // ── Derived booleans ──────────────────────────────────────────────────────
  // Running iff:
  //   (a) the POST mutation is still in flight, OR
  //   (b) we have a tracked jobId and its state is non-terminal (or unknown
  //       because the first poll hasn't returned yet — prevents the
  //       button-flicker race), OR
  //   (c) the server's latest-payload reports an in-flight run (covers
  //       page reload + the "alreadyRunning" idempotent response).
  const isJobRunning =
    runMutation.isPending ||
    (activeJobId !== null && (!jobQ.data || RUNNING_STATES.has(jobQ.data.state))) ||
    !!latestQ.data?.inFlightRun;

  const isJobFailed = jobQ.data?.state === "failed";

  const jobFailedReason =
    isJobFailed
      ? ((jobQ.data as JobLookup<AuditJobResult>).failedReason ?? "Unknown error")
      : null;

  const hasRun = !!latestQ.data?.run;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (latestQ.isLoading) {
    return <AuditSkeleton />;
  }

  // ── Query error state ─────────────────────────────────────────────────────
  if (latestQ.isError) {
    const msg =
      latestQ.error instanceof Error ? latestQ.error.message : "Failed to load audit data.";
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px 56px",
          textAlign: "center",
        }}
      >
        <p style={{ color: "var(--red-fg)", marginBottom: 16 }}>{msg}</p>
        <button className="btn btn-ghost" onClick={() => latestQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const data = latestQ.data!;

  return (
    <div className="audit">
      {/* Header */}
      <AuditHeader
        subject={data.subject}
        totals={data.totals}
        hasRun={hasRun}
        isRunning={isJobRunning}
        onRunAudit={() => {
          if (isJobRunning) return;
          runMutation.mutate();
        }}
      />

      {/* Running progress ribbon */}
      {isJobRunning && (
        <div
          style={{
            padding: "10px 56px",
            background: "var(--amber-tint)",
            borderBottom: "1px solid var(--amber)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--amber)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          <span className="t-sm" style={{ color: "var(--amber-fg)" }}>
            Audit in progress — this takes 30–60 s
          </span>
        </div>
      )}

      {/* Job failure banner */}
      {isJobFailed && jobFailedReason && (
        <div
          role="alert"
          style={{
            padding: "12px 56px",
            background: "var(--red-tint)",
            borderBottom: "1px solid var(--red)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span className="t-sm" style={{ color: "var(--red-fg)", flex: 1 }}>
            Audit failed: {jobFailedReason}
          </span>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, height: 26 }}
            onClick={() => {
              setActiveJobId(null);
              runMutation.mutate();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state — no run yet AND no active job */}
      {!hasRun && !isJobRunning ? (
        <EmptyAuditState isRunning={isJobRunning} onRunAudit={() => {
          if (isJobRunning) return;
          runMutation.mutate();
        }} />
      ) : (
        <>
          {/* Filter row */}
          <FilterRow
            filter={filter}
            onFilterChange={setFilter}
            totals={data.totals}
            onMapClick={() => navigate({ to: "/map/$subjectId", params: { subjectId } })}
          />

          {/* Unit list */}
          <div style={{ padding: "16px 56px 80px" }}>
            {filteredUnits.length === 0 ? (
              <p className="t-sm t-faint" style={{ padding: "32px 0", fontStyle: "italic" }}>
                No concepts match the current filter.
              </p>
            ) : (
              filteredUnits.map((u) => (
                <UnitBlock key={u.id} unit={u} onPick={setActiveConcept} />
              ))
            )}
          </div>
        </>
      )}

      {/* Concept drawer */}
      {activeConcept && data.run && (
        <ConceptDrawer
          concept={activeConcept}
          runId={data.run.id}
          onClose={() => setActiveConcept(null)}
        />
      )}

      {/* Inline keyframe for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
