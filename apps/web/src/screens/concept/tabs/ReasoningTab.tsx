// ReasoningTab — Step 1–4 trace blocks.
// Mirrors design/screen-concept.jsx lines 79–98.
// Uses getAuditRun(runId, conceptId) for trace data.
import type { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditRun } from "../../../api/audit";
import type { CompletionLatestResponse } from "../../../api/completion";
import type { ConceptDetail } from "../../../api/concepts";

interface ReasoningTabProps {
  runId: string | null;
  conceptId: string;
  concept: ConceptDetail;
  latestCompletion: CompletionLatestResponse | null;
}

export const ReasoningTab: FC<ReasoningTabProps> = ({
  runId,
  conceptId,
  concept,
  latestCompletion,
}) => {
  const traceQ = useQuery({
    queryKey: ["audit", "run", runId, "concept", conceptId],
    queryFn: () => getAuditRun(runId!, conceptId),
    enabled: !!runId,
    staleTime: 5 * 60 * 1000,
  });

  if (!runId) {
    return (
      <div className="fade-in">
        <p className="t-body t-muted" style={{ fontStyle: "italic" }}>
          Run an audit first to see reasoning.
        </p>
      </div>
    );
  }

  if (traceQ.isLoading) {
    return (
      <div className="fade-in">
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          Loading trace…
        </p>
      </div>
    );
  }

  if (traceQ.isError) {
    return (
      <div className="fade-in">
        <p className="t-sm" style={{ color: "var(--red-fg)" }}>
          Could not load reasoning trace. Try again.
        </p>
      </div>
    );
  }

  const conceptTrace = traceQ.data?.concepts?.[0];
  const topFragment = conceptTrace?.trace.topFragments?.[0];

  // Step 3 color: amber if top fragment below 0.78, red if no fragments
  const topSim = topFragment?.similarity ?? 0;
  const step3Color =
    (conceptTrace?.trace.topFragments?.length ?? 0) === 0
      ? "red"
      : topSim >= 0.78
        ? "green"
        : "amber";

  // Step 4 color: based on concept state from audit
  const state = conceptTrace?.state ?? "red";
  const step4Color = state === "green" ? "green" : state === "amber" ? "amber" : "red";

  // Citation count for Step 2
  const citationCount = Object.keys(latestCompletion?.citations ?? {}).length;
  // Use distinct source count from citations
  const sourceIds = new Set(
    Object.values(latestCompletion?.citations ?? {}).map((c) => c.sourceId),
  );
  const sourceCount = sourceIds.size;

  const loText = concept.learningObjective ?? "";
  const confidence = latestCompletion?.completion?.confidence?.toFixed(2) ?? "—";

  return (
    <div className="fade-in">
      {/* Step 1 — Extracted from syllabus */}
      <div className="trace-step green">
        <div className="cap-sm" style={{ marginBottom: 4 }}>
          Step 1 · Extracted from syllabus
        </div>
        <div className="t-body">
          {concept.name} identified as atomic concept
          {loText ? (
            <>
              {" "}
              under <span className="serif italic">{loText.split(".")[0]}</span>
            </>
          ) : null}
          .
        </div>
      </div>

      {/* Step 2 — Bibliography indexed */}
      <div className="trace-step green">
        <div className="cap-sm" style={{ marginBottom: 4 }}>
          Step 2 · Bibliography indexed
        </div>
        <div className="t-body">
          {citationCount > 0 ? (
            <>
              {citationCount} passage{citationCount !== 1 ? "s" : ""} located across{" "}
              {sourceCount} source{sourceCount !== 1 ? "s" : ""}.
            </>
          ) : (
            "Bibliography scanned for relevant passages."
          )}
        </div>
      </div>

      {/* Step 3 — Semantic retrieval */}
      <div className={`trace-step ${step3Color}`}>
        <div className="cap-sm" style={{ marginBottom: 4 }}>
          Step 3 · Semantic retrieval over your notes
        </div>
        <div className="t-body">
          {traceQ.data?.concepts?.[0]?.fragments != null ? (
            <>
              Scanned {traceQ.data.concepts[0].fragments} fragment
              {traceQ.data.concepts[0].fragments !== 1 ? "s" : ""}.{" "}
              {topFragment ? (
                <>
                  Top match scored{" "}
                  <span className="mono">{topFragment.similarity.toFixed(2)}</span>
                  {topSim < 0.78 ? (
                    <>
                      {" "}
                      — below threshold of <span className="mono">0.78</span>
                    </>
                  ) : null}
                  .
                </>
              ) : (
                "No matching fragments found."
              )}
            </>
          ) : (
            "Retrieval data not available."
          )}
        </div>
      </div>

      {/* Step 4 — Verdict */}
      <div className={`trace-step ${step4Color}`}>
        <div className="cap-sm" style={{ marginBottom: 4 }}>
          Step 4 · Verdict
        </div>
        <div className="t-body">
          {state === "green"
            ? "Concept is well-covered in your notes."
            : state === "amber"
              ? "Concept is partially covered — depth insufficient."
              : "No paragraph engages the concept directly."}{" "}
          {confidence !== "—" && (
            <span className="t-muted">Confidence: {confidence}.</span>
          )}
        </div>
      </div>
    </div>
  );
};
