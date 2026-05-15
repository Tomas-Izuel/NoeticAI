// CostBadge — dev-only token + cents pill.
// Visible when import.meta.env.DEV or when ?dev=1 query param is present.
import type { FC } from "react";
import type { CompletionLatestResponse } from "../../api/completion";
import { computeCents } from "../../lib/cost-rates";

interface CostBadgeProps {
  completion: NonNullable<CompletionLatestResponse["completion"]>;
}

export const CostBadge: FC<CostBadgeProps> = ({ completion }) => {
  const isDevMode =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).get("dev") === "1";

  if (!isDevMode) return null;

  const cents = computeCents({
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    cacheReadInputTokens: completion.cacheReadInputTokens,
    cacheWriteInputTokens: completion.cacheWriteInputTokens,
  });

  const totalTokens = completion.inputTokens + completion.outputTokens;

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 8,
        alignItems: "center",
        padding: "3px 10px",
        background: "var(--elevated)",
        border: "1px solid var(--line)",
        borderRadius: 4,
      }}
    >
      <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
        {totalTokens.toLocaleString()} tok
      </span>
      <span
        style={{
          width: 1,
          height: 10,
          background: "var(--line-strong)",
        }}
      />
      <span className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>
        {cents.toFixed(3)}¢
      </span>
      {completion.cacheReadInputTokens > 0 && (
        <>
          <span style={{ width: 1, height: 10, background: "var(--line-strong)" }} />
          <span className="mono" style={{ fontSize: 10.5, color: "var(--green-fg)" }}>
            cache hit
          </span>
        </>
      )}
    </div>
  );
};
