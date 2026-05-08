import type { FC } from "react";
import type { CoverageState, AuditTotals } from "../../api/audit";
import { Icon } from "./primitives";

export type Filter = "all" | CoverageState;

interface FilterRowProps {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  totals: AuditTotals | null;
  onMapClick?: () => void;
}

export const FilterRow: FC<FilterRowProps> = ({
  filter,
  onFilterChange,
  totals,
  onMapClick,
}) => {
  const chips: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All concepts", count: totals?.concepts ?? 0 },
    { id: "red", label: "Missing", count: totals?.missing ?? 0 },
    { id: "amber", label: "Incomplete", count: totals?.partial ?? 0 },
    { id: "green", label: "Covered", count: totals?.covered ?? 0 },
  ];

  return (
    <div
      style={{
        padding: "24px 56px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <span className="cap">Filter</span>
      {chips.map((f) => (
        <button
          key={f.id}
          onClick={() => onFilterChange(f.id)}
          className={`filter-chip ${filter === f.id ? "active" : ""}`}
        >
          {f.id !== "all" && <span className={`cov-dot ${f.id}`} />}
          {f.label}
          <span className="mono" style={{ color: "var(--fg-faint)", fontSize: 10.5 }}>
            {f.count}
          </span>
        </button>
      ))}
      <span style={{ flex: 1 }} />
      <span className="t-sm t-faint mono">view: spine</span>
      <button
        className="icon-btn"
        onClick={onMapClick}
        title="Switch to constellation"
        type="button"
      >
        <Icon name="graph" size={15} />
      </button>
      <button className="icon-btn active-icon" title="Spine view" type="button">
        <Icon name="spine" size={15} />
      </button>
    </div>
  );
};
