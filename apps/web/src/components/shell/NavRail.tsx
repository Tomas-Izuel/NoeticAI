import type { FC } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import type { Subject } from "../../api/subjects";
import { Icon } from "../../screens/audit/primitives";

interface NavRailProps {
  activeSubjectId: string | null;
  activeSubject: Subject | null;
  topGapConceptId: string | null;
}

export const NavRail: FC<NavRailProps> = ({
  activeSubjectId,
  activeSubject,
  topGapConceptId,
}) => {
  const { pathname } = useLocation();

  const isActive = (prefix: string) => pathname.startsWith(prefix);

  // Coverage count — partial + missing, with alert class.
  const coverageCount =
    activeSubject != null
      ? activeSubject.totals.partial + activeSubject.totals.missing
      : null;

  // Concept count for "Note augmentation" row is omitted in v1.
  // We show it only when we have a subject (as a rough signal).

  return (
    <aside className="nav">
      {/* ── Audit ─────────────────────────────────────────────── */}
      <div className="nav-section">
        <div className="nav-cap">Audit</div>

        {activeSubjectId ? (
          <Link
            className={`nav-row${isActive("/audit/") ? " active" : ""}`}
            to="/audit/$subjectId"
            params={{ subjectId: activeSubjectId }}
          >
            <span className="nav-icon">
              <Icon name="spine" size={14} />
            </span>
            <span style={{ flex: 1 }}>Coverage spine</span>
            {coverageCount != null && (
              <span
                className={`nav-count${coverageCount > 0 ? " alert" : ""}`}
              >
                {coverageCount}
              </span>
            )}
          </Link>
        ) : (
          <div
            className="nav-row"
            style={{ opacity: 0.4, cursor: "not-allowed" }}
            title="Select a subject first"
          >
            <span className="nav-icon">
              <Icon name="spine" size={14} />
            </span>
            <span style={{ flex: 1 }}>Coverage spine</span>
          </div>
        )}

        {activeSubjectId ? (
          <Link
            className={`nav-row${isActive("/map/") ? " active" : ""}`}
            to="/map/$subjectId"
            params={{ subjectId: activeSubjectId }}
          >
            <span className="nav-icon">
              <Icon name="graph" size={14} />
            </span>
            <span style={{ flex: 1 }}>Constellation</span>
          </Link>
        ) : (
          <div
            className="nav-row"
            style={{ opacity: 0.4, cursor: "not-allowed" }}
            title="Select a subject first"
          >
            <span className="nav-icon">
              <Icon name="graph" size={14} />
            </span>
            <span style={{ flex: 1 }}>Constellation</span>
          </div>
        )}

        {topGapConceptId ? (
          <Link
            className={`nav-row${isActive("/concept/") ? " active" : ""}`}
            to="/concept/$conceptId"
            params={{ conceptId: topGapConceptId }}
          >
            <span className="nav-icon">
              <Icon name="ledger" size={14} />
            </span>
            <span style={{ flex: 1 }}>Concept detail</span>
          </Link>
        ) : (
          <div
            className="nav-row"
            style={{ opacity: 0.4, cursor: "not-allowed" }}
            title={activeSubjectId ? "Run an audit first" : "Select a subject first"}
          >
            <span className="nav-icon">
              <Icon name="ledger" size={14} />
            </span>
            <span style={{ flex: 1 }}>Concept detail</span>
          </div>
        )}
      </div>

      {/* ── Notes ─────────────────────────────────────────────── */}
      <div className="nav-section">
        <div className="nav-cap">Notes</div>
        <div
          className="nav-row"
          style={{ opacity: 0.4, cursor: "not-allowed" }}
          title="No notes loaded"
        >
          <span className="nav-icon">
            <Icon name="note" size={14} />
          </span>
          <span style={{ flex: 1 }}>Note augmentation</span>
        </div>
      </div>

      {/* ── Sources ───────────────────────────────────────────── */}
      <div className="nav-section">
        <div className="nav-cap">Sources</div>

        {activeSubjectId ? (
          <Link
            className={`nav-row${isActive("/bibliography") ? " active" : ""}`}
            to="/bibliography"
            search={{ subjectId: activeSubjectId }}
          >
            <span className="nav-icon">
              <Icon name="book" size={14} />
            </span>
            <span style={{ flex: 1 }}>Bibliography</span>
          </Link>
        ) : (
          <div
            className="nav-row"
            style={{ opacity: 0.4, cursor: "not-allowed" }}
            title="Select a subject first"
          >
            <span className="nav-icon">
              <Icon name="book" size={14} />
            </span>
            <span style={{ flex: 1 }}>Bibliography</span>
          </div>
        )}

        <Link
          className={`nav-row${isActive("/onboarding") ? " active" : ""}`}
          to="/onboarding"
        >
          <span className="nav-icon">
            <Icon name="compass" size={14} />
          </span>
          <span style={{ flex: 1 }}>Syllabus</span>
        </Link>
      </div>

      {/* ── Account ───────────────────────────────────────────── */}
      <div className="nav-section">
        <div className="nav-cap">Account</div>

        <Link
          className={`nav-row${isActive("/plan") ? " active" : ""}`}
          to="/plan"
        >
          <span className="nav-icon">
            <Icon name="spark" size={14} />
          </span>
          <span style={{ flex: 1 }}>Plan & usage</span>
        </Link>

        <Link
          className={`nav-row${isActive("/settings") ? " active" : ""}`}
          to="/settings"
        >
          <span className="nav-icon">
            <Icon name="settings" size={14} />
          </span>
          <span style={{ flex: 1 }}>Settings</span>
        </Link>
      </div>

      {/* ── System ────────────────────────────────────────────── */}
      <div className="nav-section">
        <div className="nav-cap">System</div>

        <Link
          className={`nav-row${pathname === "/onboarding" ? " active" : ""}`}
          to="/onboarding"
        >
          <span className="nav-icon">
            <Icon name="sync" size={14} />
          </span>
          <span style={{ flex: 1 }}>Setup</span>
        </Link>
      </div>

      {/* ── Nav foot ──────────────────────────────────────────── */}
      {activeSubject && (
        <div className="nav-foot">
          <div className="nav-status">
            <span className="dot" />
            <span>Notion · pending</span>
          </div>
          <div className="nav-status" style={{ color: "var(--fg-whisper)" }}>
            <span className="mono" style={{ fontSize: 10 }}>
              {activeSubject.totals.concepts} concepts
            </span>
          </div>
        </div>
      )}
    </aside>
  );
};
