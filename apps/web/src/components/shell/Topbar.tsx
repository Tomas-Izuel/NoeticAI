import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import type { Subject } from "../../api/subjects";
import { Icon } from "../../screens/audit/primitives";
import { routeToBreadcrumbs } from "../../lib/routeToBreadcrumbs";
import { SubjectSwitcher } from "./SubjectSwitcher";
import { useSignOut } from "../../api/auth";

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
      <Link
        to="/"
        className="topbar-brand"
        style={{ textDecoration: "none", color: "inherit", cursor: "pointer" }}
      >
        <span className="topbar-mark">NoeticAI</span>
        <span className="topbar-tag">v0.0 · phase 5</span>
      </Link>

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

        <UserMenu initials={user?.initials ?? "?"} />
      </div>
    </header>
  );
};

// ─── User menu (avatar → dropdown with Settings + Sign out) ─────────────────

function UserMenu({ initials }: { initials: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const signOut = useSignOut();

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Cuenta"
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
          cursor: "pointer",
          padding: 0,
          transition: "border-color 120ms, color 120ms",
        }}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 180,
            padding: 4,
            background: "var(--base)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            boxShadow: "var(--float)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <MenuLink to="/settings" onSelect={() => setOpen(false)}>
            Ajustes
          </MenuLink>
          <MenuLink to="/plan" onSelect={() => setOpen(false)}>
            Plan y uso
          </MenuLink>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 2px" }} />
          <MenuButton
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            tone="danger"
          >
            Cerrar sesión
          </MenuButton>
        </div>
      )}
    </div>
  );
}

const MENU_ITEM_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "7px 10px",
  borderRadius: 4,
  fontSize: 12.5,
  fontFamily: "var(--sans)",
  color: "var(--fg)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  textDecoration: "none",
  transition: "background 100ms",
};

function MenuLink({
  to,
  onSelect,
  children,
}: {
  to: "/settings" | "/plan";
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onSelect}
      style={MENU_ITEM_STYLE}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </Link>
  );
}

function MenuButton({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        ...MENU_ITEM_STYLE,
        color: tone === "danger" ? "var(--red-fg)" : "var(--fg)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          tone === "danger" ? "var(--red-tint)" : "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
