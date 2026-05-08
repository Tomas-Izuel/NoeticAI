import type { FC } from "react";
import type { AuditLatest } from "../../api/audit";
import { Icon } from "./primitives";

interface AuditHeaderProps {
  subject: AuditLatest["subject"];
  totals: AuditLatest["totals"];
  hasRun: boolean;
  isRunning: boolean;
  onRunAudit: () => void;
}

export const AuditHeader: FC<AuditHeaderProps> = ({
  subject,
  totals,
  hasRun,
  isRunning,
  onRunAudit,
}) => {
  const t = totals;
  const total = t?.concepts ?? 0;

  const segs = [
    { state: "green" as const, n: t?.covered ?? 0, label: "Covered" },
    { state: "amber" as const, n: t?.partial ?? 0, label: "Incomplete" },
    { state: "red" as const, n: t?.missing ?? 0, label: "Missing" },
  ];

  return (
    <div style={{ padding: "40px 56px 32px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 48, flexWrap: "wrap" }}>
        {/* Left: identity */}
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <div className="cap" style={{ marginBottom: 12 }}>
            Subject{subject.term ? ` · ${subject.term}` : ""}
          </div>
          <h1
            className="serif"
            style={{
              marginBottom: 14,
              fontWeight: 400,
              fontSize: 36,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            <span className="italic">{subject.name}</span>
            <span style={{ color: "var(--fg-faint)" }}> — </span>
            <span style={{ color: "var(--fg-muted)", fontSize: 24 }}>a coverage audit</span>
          </h1>
          <p className="t-read t-muted" style={{ maxWidth: 620, fontSize: 15.5, lineHeight: 1.6 }}>
            Episteme has read your notes
            {subject.course ? (
              <>
                {" and compared them against the "}
                <span style={{ color: "var(--fg)" }}>{subject.course}</span>
                {" syllabus."}
              </>
            ) : (
              " and compiled a coverage audit."
            )}
          </p>
        </div>

        {/* Right: coverage spine or run CTA */}
        <div style={{ flex: "0 1 340px", minWidth: 280 }}>
          {hasRun && t ? (
            <>
              <div className="cap" style={{ marginBottom: 12 }}>
                Coverage · {total} atomic concepts
              </div>
              {/* Segmented spine */}
              <div style={{ display: "flex", height: 6, marginBottom: 14, gap: 1 }}>
                {segs.map((s) => (
                  <div
                    key={s.state}
                    style={{
                      width: total > 0 ? `${(s.n / total) * 100}%` : "33%",
                      background:
                        s.state === "green"
                          ? "var(--green)"
                          : s.state === "amber"
                            ? "var(--amber)"
                            : "var(--red)",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 1,
                  background: "var(--line)",
                }}
              >
                {segs.map((s) => (
                  <div key={s.state} style={{ padding: "10px 12px", background: "var(--canvas)" }}>
                    <div
                      className="serif"
                      style={{ fontSize: 28, lineHeight: 1, color: "var(--fg)", fontWeight: 400 }}
                    >
                      {s.n}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <span className={`cov-dot ${s.state}`} />
                      <span className="cap-sm">{s.label}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}>
                      {total > 0 ? ((s.n / total) * 100).toFixed(1) : "0.0"}%
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button
                  className="btn btn-primary"
                  disabled
                  title="Phase 5"
                  style={{ cursor: "not-allowed", opacity: 0.4 }}
                >
                  <Icon name="sparkle" size={13} />
                  {" "}Complete the {t.missing} gaps
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={onRunAudit}
                  disabled={isRunning}
                  title="Re-run audit"
                >
                  <Icon name="sync" size={13} />
                  {isRunning ? " Running…" : " Re-run"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="cap" style={{ marginBottom: 12 }}>No audit yet</div>
              <p className="t-sm t-muted" style={{ marginBottom: 16, lineHeight: 1.6 }}>
                Run an audit to see how well your notes cover the syllabus concepts.
              </p>
              <button
                className="btn btn-primary"
                onClick={onRunAudit}
                disabled={isRunning}
              >
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
