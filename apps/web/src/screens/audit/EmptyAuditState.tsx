import type { FC } from "react";
import { Icon } from "./primitives";

interface EmptyAuditStateProps {
  isRunning: boolean;
  onRunAudit: () => void;
}

export const EmptyAuditState: FC<EmptyAuditStateProps> = ({ isRunning, onRunAudit }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "80px 56px",
      textAlign: "center",
    }}
  >
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 8,
        background: "var(--elevated)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        color: "var(--fg-muted)",
      }}
    >
      <Icon name="compass" size={22} />
    </div>
    <h2
      className="serif"
      style={{ fontSize: 22, fontWeight: 400, marginBottom: 8, color: "var(--fg)" }}
    >
      No coverage data yet
    </h2>
    <p className="t-muted" style={{ maxWidth: 380, lineHeight: 1.6, marginBottom: 28, fontSize: 14 }}>
      Run an audit to compare your notes against the syllabus and discover which concepts you have
      covered, partially addressed, or missed entirely.
    </p>
    <button className="btn btn-primary" onClick={onRunAudit} disabled={isRunning}>
      {isRunning ? (
        <>
          <Icon name="sync" size={13} />
          {" "}Auditing…
        </>
      ) : (
        <>
          <Icon name="sparkle" size={13} />
          {" "}Run your first audit
        </>
      )}
    </button>
    {isRunning && (
      <p className="t-sm t-faint" style={{ marginTop: 14 }}>
        Audit in progress — this takes 30–60 s
      </p>
    )}
  </div>
);
