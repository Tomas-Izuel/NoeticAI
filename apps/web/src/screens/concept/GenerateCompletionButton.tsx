// GenerateCompletionButton — "Generate completion" button + spinner.
// Disabled while a job is running.
import type { FC } from "react";
import { Icon } from "./primitives";

interface GenerateCompletionButtonProps {
  isRunning: boolean;
  onGenerate: () => void;
}

export const GenerateCompletionButton: FC<GenerateCompletionButtonProps> = ({
  isRunning,
  onGenerate,
}) => (
  <div
    style={{
      padding: "48px 0",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 12,
    }}
  >
    <p className="t-body t-muted" style={{ marginBottom: 8 }}>
      Generate a completion grounded in your bibliography.
    </p>
    <button
      className="btn btn-primary btn-lg"
      onClick={onGenerate}
      disabled={isRunning}
    >
      {isRunning ? (
        <>
          <Icon name="sync" size={14} />
          Generating…
        </>
      ) : (
        <>
          <Icon name="sparkle" size={14} />
          Generate completion
        </>
      )}
    </button>
  </div>
);
