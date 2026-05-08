import type { FC } from "react";
import type { SourceListItem } from "../../api/sources";

interface StatsRowProps {
  sources: SourceListItem[];
}

export const StatsRow: FC<StatsRowProps> = ({ sources }) => {
  const indexed = sources.filter((s) => s.status === "ready").length;
  const pending = sources.length - indexed;

  const stats = [
    { label: "Total sources", value: String(sources.length), hint: null, small: false },
    {
      label: "Indexed",
      value: String(indexed),
      hint: pending > 0 ? `${pending} pending` : null,
      small: false,
    },
    { label: "Passages cited", value: "—", hint: null, small: false },
    { label: "Most cited", value: "—", hint: null, small: true },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 1,
        background: "var(--line)",
        margin: "0 56px 32px",
      }}
    >
      {stats.map((s) => (
        <div key={s.label} style={{ padding: "18px 20px", background: "var(--canvas)" }}>
          <div className="cap-sm" style={{ marginBottom: 8 }}>
            {s.label}
          </div>
          <div
            className="serif"
            style={{ fontSize: s.small ? 18 : 28, lineHeight: 1, fontWeight: 400 }}
          >
            {s.value}
          </div>
          {s.hint && (
            <div className="t-xs t-faint mono" style={{ marginTop: 6 }}>
              {s.hint}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
