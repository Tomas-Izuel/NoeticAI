import { useEffect, useRef, type FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { AuditConcept, AuditRunDetailFragment, ConceptVerdict } from "../../api/audit";
import { getAuditRun } from "../../api/audit";
import { CovGlyph, DepthBar, Icon } from "./primitives";

interface ConceptDrawerProps {
  concept: AuditConcept;
  runId: string;
  onClose: () => void;
}

const VERDICT_LABEL: Record<ConceptVerdict, string> = {
  engages: "engages",
  mentions: "mentions",
  tangential: "tangential",
  "off-topic": "off-topic",
};

const verdictPillClass = (v: ConceptVerdict): string => {
  if (v === "engages") return "cov-pill green";
  if (v === "mentions") return "cov-pill amber";
  return "cov-pill neutral";
};

interface FragmentCardProps {
  fragment: AuditRunDetailFragment | AuditConcept["previews"][number];
  noteTitle?: string;
}

const FragmentCard: FC<FragmentCardProps> = ({ fragment, noteTitle }) => {
  const sim = Math.round(fragment.similarity * 100);
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--elevated)",
        borderRadius: 4,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className={verdictPillClass(fragment.verdict)}>
          {VERDICT_LABEL[fragment.verdict]}
        </span>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", marginLeft: "auto" }}>
          sim {sim}%
        </span>
      </div>
      <p
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--fg-muted)",
          margin: 0,
          fontStyle: "italic",
        }}
      >
        {fragment.fragmentText}
      </p>
      {noteTitle && (
        <div className="t-sm t-faint" style={{ marginTop: 8 }}>
          {noteTitle}
        </div>
      )}
    </div>
  );
};

export const ConceptDrawer: FC<ConceptDrawerProps> = ({ concept, runId, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Deep trace — fetched on demand (top-20). Only fires if user wants more than the bundled 3.
  const deepQ = useQuery({
    queryKey: ["audit", "run", runId, "concept", concept.id],
    queryFn: () => getAuditRun(runId, concept.id),
    // Don't auto-fetch — we have previews. User clicks "See all evidence" to trigger.
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Trap focus within drawer
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  const detailFragments: AuditRunDetailFragment[] | null =
    deepQ.data?.concepts?.[0]?.trace.topFragments ?? null;

  const showingDeep = !!detailFragments;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 40,
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Concept detail: ${concept.name}`}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--base)",
          borderLeft: "1px solid var(--line-strong)",
          zIndex: 50,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--line)",
            position: "sticky",
            top: 0,
            background: "var(--base)",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <CovGlyph state={concept.state} depth={concept.depth} size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                className="serif"
                style={{ fontSize: 20, fontWeight: 400, margin: 0, lineHeight: 1.25 }}
              >
                {concept.name}
              </h2>
              {concept.learningObjective && (
                <p className="t-sm t-faint italic" style={{ marginTop: 4, margin: "4px 0 0" }}>
                  {concept.learningObjective}
                </p>
              )}
            </div>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close drawer"
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 32px", flex: 1 }}>
          {/* Open concept page — primary CTA for amber/red, secondary for green */}
          <Link
            to="/concept/$conceptId"
            params={{ conceptId: concept.id }}
            className={
              concept.state === "green" ? "btn btn-secondary" : "btn btn-primary"
            }
            style={{
              width: "100%",
              justifyContent: "center",
              marginBottom: 24,
            }}
          >
            <Icon name="sparkle" size={13} />
            {concept.state === "green"
              ? "Open concept page"
              : "Open concept · Generate completion"}
          </Link>

          {/* State + depth */}
          <div style={{ marginBottom: 24 }}>
            <div className="cap" style={{ marginBottom: 10 }}>Coverage summary</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: 1,
                background: "var(--line)",
                marginBottom: 14,
              }}
            >
              {[
                { label: "Verdict", value: concept.state },
                { label: "Mentions", value: String(concept.mentions) },
                { label: "Sources", value: String(concept.sources) },
                { label: "Fragments", value: String(concept.fragments) },
              ].map((item) => (
                <div key={item.label} style={{ padding: "8px 10px", background: "var(--base)" }}>
                  <div className="cap-sm" style={{ marginBottom: 4 }}>
                    {item.label}
                  </div>
                  {item.label === "Verdict" ? (
                    <span
                      className={`cov-pill ${concept.state}`}
                      style={{ fontSize: 11 }}
                    >
                      {concept.state === "green"
                        ? "covered"
                        : concept.state === "amber"
                          ? "incomplete"
                          : "missing"}
                    </span>
                  ) : (
                    <div
                      className="serif"
                      style={{ fontSize: 20, lineHeight: 1, color: "var(--fg)", fontWeight: 400 }}
                    >
                      {item.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="cap-sm" style={{ marginBottom: 6 }}>
              Depth score
            </div>
            <DepthBar depth={concept.depth} state={concept.state} />
          </div>

          {/* Evidence */}
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <span className="cap">Evidence</span>
              {concept.previews.length > 0 && !showingDeep && (
                <button
                  className="btn btn-ghost"
                  style={{ marginLeft: "auto", fontSize: 11, height: 24, padding: "0 10px" }}
                  onClick={() => deepQ.refetch()}
                  disabled={deepQ.isFetching}
                >
                  {deepQ.isFetching ? "Loading…" : "See all evidence"}
                </button>
              )}
            </div>

            {concept.previews.length === 0 && !showingDeep && (
              <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
                No matching fragments found in your notes for this concept.
              </p>
            )}

            {showingDeep
              ? detailFragments!.map((f) => (
                  <FragmentCard key={f.fragmentId} fragment={f} noteTitle={f.noteTitle} />
                ))
              : concept.previews.map((p) => <FragmentCard key={p.fragmentId} fragment={p} />)}

            {deepQ.isError && (
              <p className="t-sm" style={{ color: "var(--red-fg)", marginTop: 8 }}>
                Could not load full trace. Try again.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
