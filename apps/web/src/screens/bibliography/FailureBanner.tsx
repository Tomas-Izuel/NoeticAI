import type { FC } from "react";
import type { SourceListItem } from "../../api/sources";
import { Icon } from "./icons";

interface FailureBannerProps {
  failedSources: SourceListItem[];
  isReindexPending: boolean;
  onReindex: (sourceId: string) => void;
}

const MAX_SHOWN = 3;

export const FailureBanner: FC<FailureBannerProps> = ({
  failedSources,
  isReindexPending,
  onReindex,
}) => {
  if (failedSources.length === 0) return null;

  const shown = failedSources.slice(0, MAX_SHOWN);
  const overflow = failedSources.length - MAX_SHOWN;

  return (
    <div
      className="panel"
      role="alert"
      style={{
        margin: "24px 56px 0",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        border: "1px solid var(--red)",
        background: "var(--red-tint)",
      }}
    >
      {/* Summary line */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Icon name="info" size={16} style={{ color: "var(--red-fg)", flexShrink: 0 }} />
        <p className="t-sm" style={{ flex: 1, color: "var(--fg-muted)", lineHeight: 1.5, margin: 0 }}>
          <strong style={{ color: "var(--fg)" }}>
            {failedSources.length} source{failedSources.length > 1 ? "s" : ""} failed to index
          </strong>{" "}
          · Episteme will not cite un-indexed sources. Re-index or delete each one.
        </p>
      </div>

      {/* Per-source rows */}
      {shown.map((source) => (
        <div
          key={source.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            paddingLeft: 30,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="t-sm" style={{ margin: 0, color: "var(--fg)" }}>
              {source.author ? `${source.author.split(",")[0]}. ` : ""}
              <em>{source.title}</em>
            </p>
            {source.failureReason && (
              <p className="t-xs t-faint" style={{ margin: "2px 0 0" }}>
                {source.failureReason}
              </p>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onReindex(source.id)}
            disabled={isReindexPending}
            style={{ flexShrink: 0 }}
          >
            <Icon name="sync" size={12} />
            {" "}Re-index {source.author ? source.author.split(",")[0] : source.title.slice(0, 12)}
            {source.year ? ` ${source.year}` : ""}
          </button>
        </div>
      ))}

      {overflow > 0 && (
        <p className="t-xs t-faint" style={{ paddingLeft: 30, margin: 0 }}>
          …and {overflow} more failed source{overflow > 1 ? "s" : ""}. Open each row to re-index.
        </p>
      )}
    </div>
  );
};
