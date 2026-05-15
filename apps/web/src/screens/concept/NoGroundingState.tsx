// NoGroundingState — renders when completion.status === 'null_no_grounding'.
import type { FC } from "react";

interface NoGroundingStateProps {
  subjectId: string;
  guardFailureReason?: string | null;
}

export const NoGroundingState: FC<NoGroundingStateProps> = ({
  subjectId,
  guardFailureReason,
}) => (
  <div
    style={{
      background: "var(--base)",
      border: "1px solid var(--line)",
      borderRadius: 8,
      padding: "32px 36px",
      marginBottom: 28,
    }}
  >
    <div className="cap" style={{ marginBottom: 10, color: "var(--amber-fg)" }}>
      No grounding found
    </div>
    <p className="t-read serif" style={{ fontSize: 16, lineHeight: 1.65, color: "var(--fg-muted)", marginBottom: 16 }}>
      No source in your bibliography supports this concept yet. Add a source or refine
      your concept tree.
    </p>
    {guardFailureReason && (
      <p className="t-sm t-faint" style={{ marginBottom: 16, fontStyle: "italic" }}>
        {guardFailureReason}
      </p>
    )}
    <a
      href={`/bibliography?subjectId=${encodeURIComponent(subjectId)}`}
      className="btn btn-secondary"
      style={{ textDecoration: "none" }}
    >
      Go to bibliography
    </a>
  </div>
);
