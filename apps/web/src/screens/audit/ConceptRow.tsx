import type { FC } from "react";
import type { AuditConcept } from "../../api/audit";
import { CovGlyph, DepthBar, Icon } from "./primitives";

interface ConceptRowProps {
  concept: AuditConcept;
  onPick: (concept: AuditConcept) => void;
}

export const ConceptRow: FC<ConceptRowProps> = ({ concept: c, onPick }) => {
  const state = c.state;
  return (
    <div className="concept-row" onClick={() => onPick(c)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(c); }}>
      <div className="cr-glyph">
        <CovGlyph state={state} depth={c.depth} size={18} />
      </div>
      <div className="cr-name">
        <div
          className="serif"
          style={{
            fontSize: 17,
            color: state === "red" ? "var(--fg-muted)" : "var(--fg)",
            fontStyle: state === "red" ? "italic" : "normal",
          }}
        >
          {c.name}
        </div>
        {c.learningObjective && (
          <div className="t-sm t-faint" style={{ marginTop: 4, fontStyle: "italic" }}>
            {c.learningObjective}
          </div>
        )}
      </div>
      <div className="cr-mentions mono">
        {c.mentions === 0 ? (
          <span style={{ color: "var(--fg-whisper)" }}>—</span>
        ) : (
          c.mentions
        )}
      </div>
      <div className="cr-sources mono">
        {c.sources === 0 ? (
          <span style={{ color: "var(--fg-whisper)" }}>—</span>
        ) : (
          c.sources
        )}
      </div>
      <div className="cr-depth">
        <DepthBar depth={c.depth} state={state} />
      </div>
      <div className="cr-state">
        {c.conflict ? (
          <span className="cov-pill amber">
            <Icon name="alert" size={11} /> conflict
          </span>
        ) : state === "green" ? (
          <span className="cov-pill green">covered</span>
        ) : state === "amber" ? (
          <span className="cov-pill amber">incomplete</span>
        ) : (
          <span className="cov-pill red">missing</span>
        )}
      </div>
      <div className="cr-action">
        <Icon name="chev-r" size={14} />
      </div>
    </div>
  );
};
