// Design tokens mirroring landing.css :root variables.
// Cannot read CSS variables inside the Remotion Player sandbox,
// so we re-declare them here as JS constants.

export const tokens = {
  // Surface scale
  canvas: "#070707",
  recessed: "#0e0e0e",
  base: "#151515",
  elevated: "#1d1d1d",
  raised: "#252525",

  // Foreground
  fg: "#ededed",
  fgMuted: "#9a9a9a",
  fgFaint: "#5e5e5e",
  fgWhisper: "#3a3a3a",

  // Hairlines
  line: "rgba(255, 255, 255, 0.06)",
  lineStrong: "rgba(255, 255, 255, 0.10)",
  lineEmph: "rgba(255, 255, 255, 0.16)",

  // Accent — oxblood
  accent: "#a8221b",
  accentSoft: "#c84a40",
  accentDeep: "#6e1610",
  accentTint: "rgba(168, 34, 27, 0.12)",
  accentTintStrong: "rgba(168, 34, 27, 0.22)",

  // Coverage states
  green: "#4d8b6a",
  greenFg: "#8fbfa3",
  greenTint: "rgba(77, 139, 106, 0.13)",

  amber: "#c08a3e",
  amberFg: "#d9b079",
  amberTint: "rgba(192, 138, 62, 0.13)",

  red: "#a8221b",
  redFg: "#d97a72",
  redTint: "rgba(168, 34, 27, 0.13)",

  // Typography stacks
  serif: "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;
