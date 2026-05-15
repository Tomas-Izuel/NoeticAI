// Sidebar — "In this unit", "Adjacent gaps", "Verdict trust".
// Mirrors design/screen-concept.jsx lines 146–181.
import type { FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuditLatest } from "../../api/audit";
import type { ConceptDetail } from "../../api/concepts";
import type { CompletionLatestResponse } from "../../api/completion";
import { CovGlyph } from "./primitives";

interface SidebarProps {
  concept: ConceptDetail;
  latestCompletion: CompletionLatestResponse | null;
}

export const Sidebar: FC<SidebarProps> = ({ concept, latestCompletion }) => {
  const subjectId = concept.subject.id;

  const auditQ = useQuery({
    queryKey: ["audit", "latest", subjectId],
    queryFn: () => getAuditLatest(subjectId),
    staleTime: 60 * 1000,
  });

  // Find the unit containing this concept from audit data
  const unitConcepts = auditQ.data?.units
    .find((u) => u.id === concept.unit?.id)
    ?.concepts ?? [];

  // Adjacent gaps — concepts adjacent in neighborhood with missing/amber state
  const neighborhoodNames = new Set(concept.neighborhood ?? []);
  const adjacentGaps = auditQ.data?.units
    .flatMap((u) => u.concepts)
    .filter((c) => c.id !== concept.id && (c.state === "red" || c.state === "amber"))
    .filter((c) => neighborhoodNames.has(c.name))
    .slice(0, 5) ?? [];

  // Verdict trust — from latest completion confidence or audit trace
  const confidence = latestCompletion?.completion?.confidence ?? null;

  return (
    <aside
      style={{
        padding: "36px 24px",
        overflowY: "auto",
        background: "var(--canvas)",
      }}
    >
      {/* In this unit */}
      <div className="cap" style={{ marginBottom: 14 }}>
        In this unit
      </div>

      {auditQ.isLoading && (
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          Loading…
        </p>
      )}

      {unitConcepts.map((n) => (
        <div
          key={n.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 0",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <CovGlyph state={n.state} depth={n.depth} size={11} />
          <span
            className="serif"
            style={{
              fontSize: 13,
              color: n.id === concept.id ? "var(--fg)" : "var(--fg-muted)",
              fontStyle: n.id === concept.id ? "italic" : "normal",
              flex: 1,
            }}
          >
            {n.name}
          </span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
            {Math.round(n.depth * 100)}
          </span>
        </div>
      ))}

      {unitConcepts.length === 0 && !auditQ.isLoading && (
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          No concepts in this unit yet.
        </p>
      )}

      {/* Adjacent gaps */}
      <div className="cap" style={{ marginTop: 28, marginBottom: 12 }}>
        Adjacent gaps
      </div>
      {adjacentGaps.length > 0 ? (
        <>
          <div className="t-sm t-muted" style={{ lineHeight: 1.55, marginBottom: 12 }}>
            Filling {concept.name} likely improves these:
          </div>
          {adjacentGaps.map((x) => (
            <div
              key={x.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}
            >
              <span className={`cov-dot ${x.state}`} />
              <span className="serif" style={{ fontSize: 13, color: "var(--fg-muted)" }}>
                {x.name}
              </span>
            </div>
          ))}
        </>
      ) : (
        <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
          No adjacent gaps found.
        </p>
      )}

      {/* Verdict trust */}
      <div className="cap" style={{ marginTop: 28, marginBottom: 12 }}>
        Verdict trust
      </div>
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span className="t-sm t-muted">Confidence</span>
          <span className="mono" style={{ fontSize: 12 }}>
            {confidence != null ? confidence.toFixed(2) : "—"}
          </span>
        </div>
        <div
          style={{
            height: 4,
            background: "var(--recessed)",
            boxShadow: "var(--inset-sm)",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              height: "100%",
              width: confidence != null ? `${Math.round(confidence * 100)}%` : "0%",
              background: "var(--green)",
            }}
          />
        </div>
        <div className="t-sm t-faint" style={{ lineHeight: 1.5 }}>
          3 retrieval methods agreed.
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, padding: "0 8px" }}>
          Flag verdict
        </button>
      </div>
    </aside>
  );
};
