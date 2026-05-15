// Episteme audit — shared primitive components.
// Translated from design/primitives.jsx into typed React components.

import type { CSSProperties, FC, ReactNode } from "react";
import type { CoverageState } from "../../api/audit";

// ── Icon ─────────────────────────────────────────────────────────────────────

interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
  title?: string;
}

export const Icon: FC<IconProps> = ({ name, size = 14, stroke = 1.6, ...rest }) => {
  const wrap = (paths: ReactNode) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );

  switch (name) {
    case "compass":
      return wrap(<><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/></>);
    case "spine":
      return wrap(<><path d="M5 4v16M9 4v16M13 4v16M17 4v16"/></>);
    case "graph":
      return wrap(<><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="12" cy="12" r="2"/><path d="M7.5 7.5l3 3M16.5 7.5l-3 3M7.5 16.5l3-3M16.5 16.5l-3-3"/></>);
    case "chev-r":
      return wrap(<polyline points="9 6 15 12 9 18"/>);
    case "chev-l":
      return wrap(<polyline points="15 6 9 12 15 18"/>);
    case "x":
      return wrap(<><path d="M18 6L6 18M6 6l12 12"/></>);
    case "alert":
      return wrap(<><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></>);
    case "filter":
      return wrap(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>);
    case "sparkle":
      return wrap(<><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/></>);
    case "sync":
      return wrap(<><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></>);
    case "check":
      return wrap(<polyline points="20 6 9 17 4 12"/>);
    case "chev-d":
      return wrap(<polyline points="6 9 12 15 18 9"/>);
    case "plus":
      return wrap(<><path d="M12 5v14M5 12h14"/></>);
    case "search":
      return wrap(<><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.35-4.35"/></>);
    case "ledger":
      return wrap(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></>);
    case "note":
      return wrap(<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></>);
    case "book":
      return wrap(<><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></>);
    case "spark":
      return wrap(<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>);
    case "settings":
      return wrap(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>);
    default:
      return wrap(<circle cx="12" cy="12" r="9"/>);
  }
};

// ── CovGlyph ──────────────────────────────────────────────────────────────────

interface CovGlyphProps {
  state?: CoverageState | "empty";
  depth?: number;
  size?: number;
}

export const CovGlyph: FC<CovGlyphProps> = ({ state = "red", depth = 0, size = 14 }) => {
  const fill =
    state === "green"
      ? "var(--green)"
      : state === "amber"
        ? "var(--amber)"
        : state === "red"
          ? "var(--red)"
          : "var(--fg-whisper)";
  const fillH = Math.max(2, Math.round(size * (state === "red" ? 0.08 : depth)));
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        background: "transparent",
        boxShadow: "inset 0 0 0 1px var(--fg-whisper)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: fillH,
          background: fill,
        }}
      />
    </span>
  );
};

// ── DepthBar ──────────────────────────────────────────────────────────────────

interface DepthBarProps {
  depth?: number;
  state?: CoverageState;
  label?: boolean;
}

export const DepthBar: FC<DepthBarProps> = ({ depth = 0, state = "red", label = true }) => {
  const fill =
    state === "green" ? "var(--green)" : state === "amber" ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
      <div
        style={{
          position: "relative",
          flex: 1,
          height: 4,
          background: "var(--recessed)",
          boxShadow: "var(--inset-sm)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.max(2, depth * 100)}%`,
            background: fill,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "33%",
            top: -2,
            bottom: -2,
            width: 1,
            background: "var(--canvas)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "66%",
            top: -2,
            bottom: -2,
            width: 1,
            background: "var(--canvas)",
          }}
        />
      </div>
      {label && (
        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--fg-faint)", minWidth: 30, textAlign: "right" }}
        >
          {Math.round(depth * 100)}
        </span>
      )}
    </div>
  );
};
