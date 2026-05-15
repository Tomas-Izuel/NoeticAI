import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Subject } from "../../api/subjects";
import { Icon } from "../../screens/audit/primitives";

interface SubjectSwitcherProps {
  subjects: Subject[];
  activeSubject: Subject | null;
  setActiveSubjectId: (id: string) => void;
}

export const SubjectSwitcher: FC<SubjectSwitcherProps> = ({
  subjects,
  activeSubject,
  setActiveSubjectId,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Zero-subjects CTA.
  if (!activeSubject) {
    return (
      <button
        className="subject-pill"
        onClick={() => void navigate({ to: "/onboarding" })}
      >
        <span
          className="glyph"
          style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}
        >
          N
        </span>
        <span style={{ color: "var(--fg-muted)" }}>New subject</span>
        <Icon name="plus" size={11} />
      </button>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button className="subject-pill" onClick={() => setOpen((o) => !o)}>
        <span className="glyph">{activeSubject.glyph ?? "N"}</span>
        <span>{activeSubject.name}</span>
        <Icon name="chev-d" size={11} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 300,
            background: "var(--elevated)",
            border: "1px solid var(--line)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
            padding: 6,
            zIndex: 50,
          }}
        >
          <div className="cap-sm" style={{ padding: "8px 10px 6px" }}>
            Switch subject
          </div>

          {subjects.map((s) => {
            const total = s.totals.concepts;
            const isActive = s.id === activeSubject.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setActiveSubjectId(s.id);
                  setOpen(false);
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 10px",
                  width: "100%",
                  background: isActive ? "var(--base)" : "transparent",
                  border: 0,
                  color: "var(--fg)",
                  textAlign: "left",
                  cursor: "pointer",
                  borderRadius: 4,
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "'Source Serif 4', serif",
                    fontStyle: "italic",
                    fontSize: 14,
                    color: "var(--accent-soft)",
                    background: "var(--recessed)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {s.glyph ?? "N"}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="serif" style={{ fontSize: 13.5, lineHeight: 1.2 }}>
                    {s.name}
                  </div>
                  <div className="t-xs t-faint" style={{ marginTop: 2 }}>
                    {s.totals.covered}/{total} engaged · {s.totals.missing} gaps
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    alignItems: "flex-end",
                  }}
                >
                  <div style={{ display: "flex", gap: 2 }}>
                    <span
                      style={{ width: 14, height: 3, background: "var(--green)" }}
                    />
                    <span
                      style={{
                        width: total > 0 ? 14 * (s.totals.partial / total) : 0,
                        height: 3,
                        background: "var(--amber)",
                        minWidth: 1,
                      }}
                    />
                    <span
                      style={{
                        width: total > 0 ? 14 * (s.totals.missing / total) : 0,
                        height: 3,
                        background: "var(--red)",
                        minWidth: 1,
                      }}
                    />
                  </div>
                </div>
              </button>
            );
          })}

          <div
            style={{ borderTop: "1px solid var(--line)", marginTop: 4, padding: "6px" }}
          >
            <button
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                width: "100%",
                background: "transparent",
                border: 0,
                color: "var(--fg-muted)",
                textAlign: "left",
                cursor: "pointer",
                borderRadius: 4,
                fontSize: 12.5,
              }}
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/onboarding" });
              }}
            >
              <Icon name="plus" size={12} /> New subject
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
