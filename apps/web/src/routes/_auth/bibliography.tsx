import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getSources, uploadPdfSource, addUrlSource, reindexSource } from "../../api/sources";
import type { SourceListItem } from "../../api/sources";
import { getSubjects } from "../../api/subjects";
import { BibliographyHeader } from "../../screens/bibliography/BibliographyHeader";
import { StatsRow } from "../../screens/bibliography/StatsRow";
import { ToolbarRow } from "../../screens/bibliography/ToolbarRow";
import { SourceList } from "../../screens/bibliography/SourceList";
import { SourceDrawer } from "../../screens/bibliography/SourceDrawer";
import { FailureBanner } from "../../screens/bibliography/FailureBanner";
import { EmptyBibliographyState } from "../../screens/bibliography/EmptyBibliographyState";

// ── Route definition ──────────────────────────────────────────────────────────

export const Route = createFileRoute("/_auth/bibliography")({
  validateSearch: (search: Record<string, unknown>) => ({
    subjectId: typeof search.subjectId === "string" ? search.subjectId : undefined,
  }),
  component: BibliographyRoute,
});

// ── Terminal statuses — polling stops once all sources are in one of these ────

const TERMINAL_STATUSES = new Set(["ready", "failed", "partial"]);

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ── Route component ───────────────────────────────────────────────────────────

function BibliographyRoute() {
  const { subjectId: searchSubjectId } = Route.useSearch();
  const navigate = useNavigate({ from: "/bibliography" });
  const qc = useQueryClient();

  // ── 1. Subjects fallback ──────────────────────────────────────────────────
  const subjectsQ = useQuery({
    queryKey: ["subjects"],
    queryFn: getSubjects,
    staleTime: 5 * 60_000,
    // Only needed when subjectId is absent from URL
    enabled: !searchSubjectId,
  });

  // Resolved subjectId: from URL → from first subject → undefined while loading
  const subjectId: string | undefined =
    searchSubjectId ??
    (subjectsQ.data?.subjects[0]?.id);

  // Persist the resolved id back to URL so refreshes work
  useEffect(() => {
    if (subjectId && !searchSubjectId) {
      void navigate({
        search: { subjectId },
        replace: true,
      });
    }
  }, [subjectId, searchSubjectId, navigate]);

  // ── 2. Sources list with polling ──────────────────────────────────────────
  const sourcesQ = useQuery({
    queryKey: ["sources", "list", subjectId ?? ""],
    queryFn: () => getSources(subjectId!),
    enabled: !!subjectId,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 10_000; // poll while loading
      const anyMidFlight = data.sources.some((s) => !isTerminal(s.status));
      return anyMidFlight ? 10_000 : false;
    },
  });

  const sources: SourceListItem[] = sourcesQ.data?.sources ?? [];
  const failedSources = sources.filter((s) => s.status === "failed");

  // ── 3. Drawer state ───────────────────────────────────────────────────────
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  // ── 4. Upload PDF mutation ────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadPdfSource({ subjectId: subjectId!, file }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] });
      // Broad invalidation: concept page re-checks eligibility on next focus
      void qc.invalidateQueries({ queryKey: ["completion-eligibility"] });
    },
  });

  // ── 5. Add URL mutation ───────────────────────────────────────────────────
  const urlMutation = useMutation({
    mutationFn: (url: string) =>
      addUrlSource({ subjectId: subjectId!, url }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] });
      void qc.invalidateQueries({ queryKey: ["completion-eligibility"] });
    },
  });

  // ── 6. Reindex mutation (used by failure banner) ──────────────────────────
  const reindexMutation = useMutation({
    mutationFn: (sourceId: string) => reindexSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] });
      void qc.invalidateQueries({ queryKey: ["completion-eligibility"] });
    },
  });

  // ── Resolve subject name for header ──────────────────────────────────────
  const subjectName =
    subjectsQ.data?.subjects.find((s) => s.id === subjectId)?.name ?? "…";

  // ── Loading / error states ────────────────────────────────────────────────

  if (!subjectId && (subjectsQ.isLoading || subjectsQ.isFetching)) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 80,
        }}
      >
        <p className="t-sm t-faint">Loading subjects…</p>
      </div>
    );
  }

  if (!subjectId) {
    return (
      <div style={{ padding: "80px 56px", textAlign: "center" }}>
        <p className="t-sm t-faint">
          No subject found. Create a subject first from the Syllabus screen.
        </p>
      </div>
    );
  }

  if (sourcesQ.isError) {
    const msg =
      sourcesQ.error instanceof Error
        ? sourcesQ.error.message
        : "Failed to load sources.";
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
        <button className="btn btn-ghost" onClick={() => sourcesQ.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const hasSources = sources.length > 0;

  return (
    <div style={{ paddingBottom: 80 }}>
      {/* Header */}
      <BibliographyHeader subjectName={subjectName} />

      {/* Stats row (always shown) */}
      <StatsRow sources={sources} />

      {/* Toolbar */}
      <ToolbarRow
        isUploadPending={uploadMutation.isPending}
        isUrlPending={urlMutation.isPending}
        onPdfFile={(file) => uploadMutation.mutate(file)}
        onUrlSubmit={(url) => urlMutation.mutate(url)}
      />

      {/* Upload / URL errors inline */}
      {uploadMutation.isError && (
        <p
          className="t-sm"
          style={{ color: "var(--red-fg)", margin: "0 56px 12px" }}
          role="alert"
        >
          Upload failed:{" "}
          {uploadMutation.error instanceof Error
            ? uploadMutation.error.message
            : "Unknown error"}
        </p>
      )}
      {urlMutation.isError && (
        <p
          className="t-sm"
          style={{ color: "var(--red-fg)", margin: "0 56px 12px" }}
          role="alert"
        >
          Failed to add URL:{" "}
          {urlMutation.error instanceof Error
            ? urlMutation.error.message
            : "Unknown error"}
        </p>
      )}

      {/* Empty or list */}
      {sourcesQ.isLoading ? (
        <div style={{ padding: "40px 56px" }}>
          <p className="t-sm t-faint">Loading sources…</p>
        </div>
      ) : !hasSources ? (
        <EmptyBibliographyState
          isUploadPending={uploadMutation.isPending}
          isUrlPending={urlMutation.isPending}
          onPdfFile={(file) => uploadMutation.mutate(file)}
          onUrlSubmit={(url) => urlMutation.mutate(url)}
        />
      ) : (
        <SourceList
          sources={sources}
          onRowClick={(s) => setActiveSourceId(s.id)}
        />
      )}

      {/* Failure banner */}
      <FailureBanner
        failedSources={failedSources}
        isReindexPending={reindexMutation.isPending}
        onReindex={(id) => reindexMutation.mutate(id)}
      />

      {/* Detail drawer */}
      {activeSourceId && (
        <SourceDrawer
          sourceId={activeSourceId}
          subjectId={subjectId}
          onClose={() => setActiveSourceId(null)}
        />
      )}

      {/* Pulse animation (re-used from audit) */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
