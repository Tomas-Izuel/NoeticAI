// EvidenceTab — candidate fragments from notes ("What you wrote").
// Maps from concepts[0].trace.topFragments.
import type { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditRun } from "../../../api/audit";

interface EvidenceTabProps {
  runId: string | null;
  conceptId: string;
}

export const EvidenceTab: FC<EvidenceTabProps> = ({ runId, conceptId }) => {
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
          Run an audit first to see evidence.
        </p>
      </div>
    );
  }

  if (traceQ.isLoading) {
    return (
      <div className="fade-in">
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          Loading evidence…
        </p>
      </div>
    );
  }

  if (traceQ.isError) {
    return (
      <div className="fade-in">
        <p className="t-sm" style={{ color: "var(--red-fg)" }}>
          Could not load evidence. Try again.
        </p>
      </div>
    );
  }

  const fragments = traceQ.data?.concepts?.[0]?.trace.topFragments ?? [];

  return (
    <div className="fade-in">
      <p className="t-body t-muted" style={{ marginBottom: 16 }}>
        Closest passages in your notes — none cross the threshold.
      </p>
      {fragments.length === 0 && (
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          No matching fragments found for this concept.
        </p>
      )}
      {fragments.map((f) => {
        const verdictLabel =
          f.verdict === "engages"
            ? "engages"
            : f.verdict === "mentions"
              ? "mentions"
              : f.verdict === "tangential"
                ? "tangential"
                : "off-topic";

        return (
          <div
            key={f.fragmentId}
            className="panel"
            style={{
              padding: "14px 18px",
              marginBottom: 8,
              display: "grid",
              gridTemplateColumns: "1fr 90px",
              gap: 18,
              alignItems: "center",
            }}
          >
            <div>
              <div className="cap-sm" style={{ marginBottom: 6 }}>
                {f.noteTitle}
              </div>
              <p
                className="serif italic"
                style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--fg-muted)", margin: 0 }}
              >
                "{f.fragmentText}"
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="mono" style={{ fontSize: 16 }}>
                {f.similarity.toFixed(2)}
              </div>
              <div className="cap-sm" style={{ marginTop: 4 }}>
                {verdictLabel}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
