// Concept header — back button, unit/week cap, concept name (serif h1), state pill,
// depth score, and "flagged N ago" timestamp.
import type { FC } from "react";
import type { ConceptDetail } from "../../api/concepts";
import type { CompletionLatestResponse } from "../../api/completion";
import { Icon } from "./primitives";

interface ConceptHeaderProps {
  concept: ConceptDetail;
  latestCompletion: CompletionLatestResponse | null;
  onBack: () => void;
}

function formatAgo(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return `flagged ${diffMin} min ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `flagged ${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `flagged ${diffD}d ago`;
}

function stateLabel(status: string | undefined): { label: string; cls: string } {
  switch (status) {
    case "pending":
    case "merged_locally":
    case "edited":
      return { label: "suggested", cls: "cov-pill amber" };
    case "rejected":
      return { label: "rejected", cls: "cov-pill neutral" };
    case "null_no_grounding":
      return { label: "missing entirely", cls: "cov-pill red" };
    case "failed":
      return { label: "generation failed", cls: "cov-pill red" };
    case "queued":
    case "running":
      return { label: "generating…", cls: "cov-pill neutral" };
    default:
      return { label: "missing entirely", cls: "cov-pill red" };
  }
}

export const ConceptHeader: FC<ConceptHeaderProps> = ({ concept, latestCompletion, onBack }) => {
  const comp = latestCompletion?.completion;
  const { label, cls } = stateLabel(comp?.status);

  const unitLabel = concept.unit
    ? `${concept.unit.name}${concept.unit.weeksLabel ? ` · ${concept.unit.weeksLabel}` : ""}`
    : concept.subject.name;

  const agoText = comp?.createdAt ? formatAgo(comp.createdAt) : "";

  return (
    <div>
      <button
        className="btn btn-ghost btn-sm"
        onClick={onBack}
        style={{ marginBottom: 18, padding: "0 8px 0 4px" }}
      >
        <Icon name="chev-l" size={13} /> Back to spine
      </button>
      <div className="cap" style={{ marginBottom: 8 }}>
        {unitLabel}
      </div>
      <h1
        className="serif"
        style={{
          fontSize: 38,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
          fontWeight: 400,
          marginBottom: 8,
        }}
      >
        {concept.name}
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 24,
          flexWrap: "wrap",
          rowGap: 8,
        }}
      >
        <span className={cls}>
          <span className={`cov-dot ${cls.includes("red") ? "red" : cls.includes("amber") ? "amber" : "empty"}`} />
          {label}
        </span>
        <span className="t-sm t-faint mono" style={{ whiteSpace: "nowrap" }}>
          depth · {comp?.confidence != null ? comp.confidence.toFixed(2) : "0.00"} / 1.00
        </span>
        {agoText && (
          <>
            <span style={{ color: "var(--fg-whisper)" }}>·</span>
            <span className="t-sm t-faint" style={{ whiteSpace: "nowrap" }}>
              {agoText}
            </span>
          </>
        )}
      </div>
    </div>
  );
};
