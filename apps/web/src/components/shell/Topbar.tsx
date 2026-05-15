import React from "react";
import { useLocation } from "@tanstack/react-router";
import type { Subject } from "../../api/subjects";
import { Icon } from "../../screens/audit/primitives";
import { routeToBreadcrumbs } from "../../lib/routeToBreadcrumbs";
import { SubjectSwitcher } from "./SubjectSwitcher";

interface TopbarProps {
  subjects: Subject[];
  activeSubject: Subject | null;
  setActiveSubjectId: (id: string) => void;
  user: { initials: string } | null;
}

export const Topbar: React.FC<TopbarProps> = ({
  subjects,
  activeSubject,
  setActiveSubjectId,
  user,
}) => {
  const { pathname } = useLocation();
  const breadcrumbs = routeToBreadcrumbs(pathname, activeSubject);

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-mark">NoeticAI</span>
        <span className="topbar-tag">v0.0 · phase 5</span>
      </div>

      <nav className="topbar-bread">
        {breadcrumbs.map((b, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === breadcrumbs.length - 1 ? "here" : ""}>{b}</span>
          </React.Fragment>
        ))}
      </nav>

      <div className="topbar-right">
        <SubjectSwitcher
          subjects={subjects}
          activeSubject={activeSubject}
          setActiveSubjectId={setActiveSubjectId}
        />

        <button className="icon-btn" title="Search" onClick={() => undefined}>
          <Icon name="search" size={15} />
        </button>

        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "var(--recessed)",
            border: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--fg-muted)",
            flexShrink: 0,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
          title={user?.initials ?? ""}
        >
          {user?.initials ?? "?"}
        </div>
      </div>
    </header>
  );
};
