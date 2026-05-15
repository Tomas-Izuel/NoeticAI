import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getConcept } from "../../api/concepts";
import { getCompletionLatest, requestCompletion } from "../../api/completion";
import type { JobLookup } from "../../lib/useAsyncJob";
import { useAsyncJob } from "../../lib/useAsyncJob";
import { ConceptHeader } from "../../screens/concept/ConceptHeader";
import { CompletionHero } from "../../screens/concept/CompletionHero";
import { NoGroundingState } from "../../screens/concept/NoGroundingState";
import { GenerateCompletionButton } from "../../screens/concept/GenerateCompletionButton";
import { CompletionFailedBanner } from "../../screens/concept/CompletionFailedBanner";
import { DetailTabs } from "../../screens/concept/DetailTabs";
import type { TabId } from "../../screens/concept/DetailTabs";
import { Sidebar } from "../../screens/concept/Sidebar";
import { CitationDrawer } from "../../screens/concept/CitationDrawer";
import type { CitationDrawerState } from "../../screens/concept/CitationDrawer";
import { CostBadge } from "../../screens/concept/CostBadge";

export const Route = createFileRoute("/_auth/concept/$conceptId")({
  component: ConceptScreenRoute,
});

interface CompletionJobResult {
  completionId: string;
  status: "succeeded" | "null_no_grounding" | "failed";
  guardFailureReason?: string;
  durationMs: number;
}

const RUNNING_STATES = new Set([
  "active",
  "waiting",
  "waiting-children",
  "delayed",
  "prioritized",
]);

function ConceptScreenRoute() {
  const { conceptId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // ── 1. Concept basics ─────────────────────────────────────────────────────
  const conceptQ = useQuery({
    queryKey: ["concept", conceptId],
    queryFn: () => getConcept(conceptId),
    staleTime: 5 * 60 * 1000,
  });

  // ── 2. Latest completion ──────────────────────────────────────────────────
  const latestQ = useQuery({
    queryKey: ["completion", "latest", conceptId],
    queryFn: () => getCompletionLatest(conceptId),
    staleTime: 30 * 1000,
    // Don't refetch while a job is in-flight — polling handles that
    refetchInterval: false,
  });

  // ── 3. Request-completion mutation → captures jobId ──────────────────────
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const completionMutation = useMutation({
    mutationFn: () => requestCompletion(conceptId),
    onSuccess: (res) => {
      if (res.cached) {
        // Cache hit — no job to poll, just refetch latest
        void qc.invalidateQueries({ queryKey: ["completion", "latest", conceptId] });
      } else if (res.jobId) {
        setActiveJobId(res.jobId);
      }
    },
  });

  // ── 4. Poll job until terminal ────────────────────────────────────────────
  const jobQ = useAsyncJob<CompletionJobResult>(activeJobId, { intervalMs: 1500 });

  useEffect(() => {
    if (!jobQ.data) return;
    if (jobQ.data.state === "completed") {
      void qc.invalidateQueries({ queryKey: ["completion", "latest", conceptId] });
      setActiveJobId(null);
    }
    // On "failed", leave activeJobId set so the failure UI renders.
    // User clicks retry (which calls completionMutation.mutate) to clear.
  }, [jobQ.data, qc, conceptId]);

  // ── 5. Tab state ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>("reasoning");

  // ── 6. Citation drawer state ──────────────────────────────────────────────
  const [drawerState, setDrawerState] = useState<CitationDrawerState>({
    open: false,
    chunkId: null,
    sourceId: null,
  });

  function handleOpenCitation(chunkId: string, sourceId: string) {
    setDrawerState({ open: true, chunkId, sourceId });
  }

  function handleCloseDrawer() {
    setDrawerState({ open: false, chunkId: null, sourceId: null });
  }

  // ── 7. Citation map (stable derivation) ──────────────────────────────────
  // Build Map<chunkId, { index, ...citation }> in first-seen order across all paragraphs.
  const citationMap = useMemo(() => {
    const map = new Map<
      string,
      {
        index: number;
        sourceId: string;
        sourceTitle: string;
        sourceAuthor: string | null;
        sourceYear: number | null;
        pagesLabel: string | null;
        chapterLabel: string | null;
        similarity: number;
      }
    >();
    const completion = latestQ.data?.completion;
    const citations = latestQ.data?.citations ?? {};
    if (!completion?.paragraphs) return map;
    let counter = 1;
    for (const paragraph of completion.paragraphs) {
      for (const chunkId of paragraph.sourceIds) {
        if (!map.has(chunkId)) {
          const cit = citations[chunkId];
          if (cit) {
            map.set(chunkId, {
              index: counter++,
              sourceId: cit.sourceId,
              sourceTitle: cit.sourceTitle,
              sourceAuthor: cit.sourceAuthor,
              sourceYear: cit.sourceYear,
              pagesLabel: cit.pagesLabel,
              chapterLabel: cit.chapterLabel,
              similarity: cit.similarity,
            });
          }
        }
      }
    }
    return map;
  }, [latestQ.data]);

  // ── Derived booleans ──────────────────────────────────────────────────────
  const isJobRunning =
    completionMutation.isPending ||
    (!!jobQ.data && RUNNING_STATES.has(jobQ.data.state));

  const isJobFailed = jobQ.data?.state === "failed";
  const jobFailedReason = isJobFailed
    ? ((jobQ.data as JobLookup<CompletionJobResult>).failedReason ?? "Unknown error")
    : null;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (conceptQ.isLoading) {
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
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          Loading concept…
        </p>
      </div>
    );
  }

  // ── Query error state ─────────────────────────────────────────────────────
  if (conceptQ.isError) {
    const msg =
      conceptQ.error instanceof Error
        ? conceptQ.error.message
        : "Failed to load concept.";
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
        <button className="btn btn-ghost" onClick={() => conceptQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const concept = conceptQ.data!.concept;
  const latestData = latestQ.data ?? null;
  const completion = latestData?.completion ?? null;
  const compStatus = completion?.status ?? null;

  const subjectId = concept.subject.id;

  function handleBack() {
    navigate({ to: "/audit/$subjectId", params: { subjectId } });
  }

  function handleGenerate() {
    setActiveJobId(null);
    completionMutation.mutate();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        minHeight: "100%",
      }}
    >
      {/* Main column */}
      <div
        style={{
          padding: "36px 48px 80px",
          borderRight: "1px solid var(--line)",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <ConceptHeader
          concept={concept}
          latestCompletion={latestData}
          onBack={handleBack}
        />

        {/* Job running ribbon */}
        {isJobRunning && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--amber-tint)",
              borderRadius: 6,
              border: "1px solid var(--amber)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 20,
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
                flexShrink: 0,
              }}
            />
            <span className="t-sm" style={{ color: "var(--amber-fg)" }}>
              Generating completion — this takes 10–30 s
            </span>
          </div>
        )}

        {/* Job failure banner (BullMQ job failed, not completion.status=failed) */}
        {isJobFailed && jobFailedReason && (
          <div
            role="alert"
            style={{
              padding: "12px 16px",
              background: "var(--red-tint)",
              border: "1px solid var(--red)",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <span className="t-sm" style={{ color: "var(--red-fg)", flex: 1 }}>
              Job failed: {jobFailedReason}
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, height: 26 }}
              onClick={() => {
                setActiveJobId(null);
                completionMutation.mutate();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Status-based hero section */}

        {/* No completion yet, or rejected → show generate button */}
        {(compStatus === null || compStatus === "rejected") && !isJobRunning && (
          <GenerateCompletionButton
            isRunning={isJobRunning}
            onGenerate={handleGenerate}
          />
        )}

        {/* Queued / running — show spinner state */}
        {(compStatus === "queued" || compStatus === "running") && !isJobRunning && (
          <div
            style={{
              padding: "36px 0",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "var(--amber)",
                animation: "pulse 1.5s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span className="t-sm t-muted">Generating completion…</span>
          </div>
        )}

        {/* Failed completion — show banner with retry */}
        {compStatus === "failed" && completion && !isJobRunning && (
          <CompletionFailedBanner
            failureReason={completion.failureReason}
            onRetry={handleGenerate}
            isRetrying={completionMutation.isPending}
          />
        )}

        {/* No grounding */}
        {compStatus === "null_no_grounding" && !isJobRunning && (
          <>
            <NoGroundingState
              subjectId={subjectId}
              guardFailureReason={completion?.guardFailureReason}
            />
            <GenerateCompletionButton isRunning={isJobRunning} onGenerate={handleGenerate} />
          </>
        )}

        {/* Pending / merged_locally / edited — show hero */}
        {completion &&
          (compStatus === "pending" ||
            compStatus === "merged_locally" ||
            compStatus === "edited") && (
            <>
              <CompletionHero
                completion={completion}
                citationMap={citationMap}
                onOpenCitation={handleOpenCitation}
                unitName={concept.unit?.name ?? null}
              />
              {/* Dev-only cost badge */}
              <div style={{ marginBottom: 12 }}>
                <CostBadge completion={completion} />
              </div>
            </>
          )}

        {/* Detail tabs — always visible once concept loaded */}
        {latestQ.isLoading ? (
          <p className="t-sm t-faint" style={{ fontStyle: "italic", marginBottom: 20 }}>
            Loading completion data…
          </p>
        ) : (
          <DetailTabs
            tab={tab}
            onTabChange={setTab}
            concept={concept}
            latestCompletion={latestData}
            citationMap={citationMap}
          />
        )}
      </div>

      {/* Sidebar */}
      <Sidebar concept={concept} latestCompletion={latestData} />

      {/* Citation drawer */}
      <CitationDrawer state={drawerState} onClose={handleCloseDrawer} />

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
