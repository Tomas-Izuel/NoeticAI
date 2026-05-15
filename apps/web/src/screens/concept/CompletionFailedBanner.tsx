// CompletionFailedBanner — red banner shown when completion.status === 'failed'.
// Shows failure_reason and a retry button.
import type { FC } from "react";

interface CompletionFailedBannerProps {
  failureReason: string | null;
  onRetry: () => void;
  isRetrying: boolean;
}

export const CompletionFailedBanner: FC<CompletionFailedBannerProps> = ({
  failureReason,
  onRetry,
  isRetrying,
}) => (
  <div
    role="alert"
    style={{
      background: "var(--red-tint)",
      border: "1px solid var(--red)",
      borderRadius: 6,
      padding: "16px 20px",
      marginBottom: 28,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}
  >
    <span className="t-sm" style={{ color: "var(--red-fg)", flex: 1 }}>
      Generation failed
      {failureReason ? `: ${failureReason}` : "."}
    </span>
    <button
      className="btn btn-ghost btn-sm"
      onClick={onRetry}
      disabled={isRetrying}
    >
      {isRetrying ? "Retrying…" : "Try again"}
    </button>
  </div>
);
