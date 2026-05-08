import type { FC } from "react";
import type { SourceListItem } from "../../api/sources";
import { StatusPill } from "./StatusPill";
import { Icon } from "./icons";

interface SourceRowProps {
  source: SourceListItem;
  isLast: boolean;
  onClick: (source: SourceListItem) => void;
}

export const SourceRow: FC<SourceRowProps> = ({ source, isLast, onClick }) => {
  const authorShort = source.author ? source.author.split(",")[0] + "." : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(source)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick(source);
      }}
      style={{
        display: "grid",
        gridTemplateColumns: "40px 1fr 90px 90px 110px 70px 90px 28px",
        padding: "14px 18px",
        borderBottom: isLast ? "none" : "1px solid var(--line)",
        alignItems: "center",
        gap: 14,
        cursor: "pointer",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "";
      }}
    >
      {/* Book icon */}
      <span
        style={{
          width: 28,
          height: 34,
          background: "var(--recessed)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "var(--fg-faint)",
        }}
      >
        <Icon name="book" size={13} />
      </span>

      {/* Title + id */}
      <div style={{ minWidth: 0 }}>
        <div className="serif" style={{ fontSize: 15 }}>
          {authorShort && (
            <span style={{ color: "var(--fg-muted)" }}>{authorShort} </span>
          )}
          <span className="italic">{source.title}</span>
        </div>
        <div className="t-xs t-faint mono" style={{ marginTop: 3 }}>
          {source.id}
        </div>
      </div>

      {/* Year */}
      <span className="mono" style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
        {source.year ?? "—"}
      </span>

      {/* Kind */}
      <span className="t-sm t-muted">{source.kind}</span>

      {/* Status */}
      <StatusPill status={source.status} failureReason={source.failureReason} />

      {/* Cited — Phase 5 placeholder */}
      <span className="mono" style={{ fontSize: 12.5, textAlign: "right", color: "var(--fg-faint)" }}>
        —
      </span>

      {/* Coverage — Phase 5 placeholder */}
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            height: 3,
            background: "var(--recessed)",
            boxShadow: "var(--inset-sm)",
            position: "relative",
          }}
        >
          <div style={{ height: "100%", width: "0%", background: "var(--green)" }} />
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 3 }}>
          —
        </div>
      </div>

      {/* Chevron */}
      <Icon name="chev-r" size={13} stroke={1.5} style={{ color: "var(--fg-faint)" }} />
    </div>
  );
};
