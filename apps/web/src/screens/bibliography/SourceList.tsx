import type { FC } from "react";
import type { SourceListItem } from "../../api/sources";
import { SourceRow } from "./SourceRow";

interface SourceListProps {
  sources: SourceListItem[];
  onRowClick: (source: SourceListItem) => void;
}

export const SourceList: FC<SourceListProps> = ({ sources, onRowClick }) => (
  <div className="panel" style={{ padding: 0, overflow: "hidden", margin: "0 56px" }}>
    {/* Column header */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px 1fr 90px 90px 110px 70px 90px 28px",
        padding: "12px 18px",
        borderBottom: "1px solid var(--line)",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span />
      <span className="cap-sm">Source</span>
      <span className="cap-sm">Year</span>
      <span className="cap-sm">Kind</span>
      <span className="cap-sm">Status</span>
      <span className="cap-sm" style={{ textAlign: "right" }}>
        Cited
      </span>
      <span className="cap-sm" style={{ textAlign: "right" }}>
        Coverage
      </span>
      <span />
    </div>

    {/* Rows */}
    {sources.map((source, i) => (
      <SourceRow
        key={source.id}
        source={source}
        isLast={i === sources.length - 1}
        onClick={onRowClick}
      />
    ))}
  </div>
);
