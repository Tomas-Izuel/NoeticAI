import type { FC } from "react";
import type { Subject } from "../../api/subjects";

interface SystemTrayProps {
  activeSubject: Subject | null;
}

export const SystemTray: FC<SystemTrayProps> = ({ activeSubject }) => {
  const totals = activeSubject?.totals;

  return (
    <footer className="tray">
      {/* Left: version + optional course */}
      <span className="mono">NoeticAI · v0.0-phase5</span>
      {activeSubject?.course && (
        <>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{activeSubject.course}</span>
        </>
      )}

      <span className="spacer" />

      {/* Right: status chips */}
      <span className="tray-item">
        <span className="dot" />
        Vector index ready
      </span>

      {/* Conflicts chip: omitted until Phase 7b */}

      {totals != null && (
        <span className="tray-item">
          <span className="dot red" />
          {totals.missing} gaps
        </span>
      )}

      {totals != null && (
        <>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>
            {totals.covered + totals.partial}/{totals.concepts} concepts engaged
          </span>
        </>
      )}
    </footer>
  );
};
