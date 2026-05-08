import type { FC } from "react";
import type { AuditConcept, AuditUnit } from "../../api/audit";
import { ConceptRow } from "./ConceptRow";

interface UnitBlockProps {
  unit: AuditUnit;
  onPick: (concept: AuditConcept) => void;
}

export const UnitBlock: FC<UnitBlockProps> = ({ unit, onPick }) => (
  <section className="unit-block">
    <div className="unit-head">
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flex: 1, minWidth: 0 }}>
        {unit.weeksLabel && (
          <span className="serif italic" style={{ fontSize: 13, color: "var(--fg-faint)" }}>
            {unit.weeksLabel}
          </span>
        )}
        <h2 className="hh-2 serif">{unit.name}</h2>
      </div>
      {/* per-unit dot grid */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", maxWidth: 160 }}>
        {unit.concepts.map((c) => (
          <span key={c.id} className={`cov-square ${c.state}`} />
        ))}
      </div>
    </div>
    <div className="unit-grid-head">
      <span />
      <span className="cap-sm">Concept</span>
      <span className="cap-sm" style={{ textAlign: "right" }}>
        Mentions
      </span>
      <span className="cap-sm" style={{ textAlign: "right" }}>
        Sources
      </span>
      <span className="cap-sm">Depth</span>
      <span className="cap-sm">Verdict</span>
      <span />
    </div>
    <div className="unit-rows">
      {unit.concepts.map((c) => (
        <ConceptRow key={c.id} concept={c} onPick={onPick} />
      ))}
    </div>
  </section>
);
