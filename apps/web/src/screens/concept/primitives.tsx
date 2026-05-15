// Concept screen — shared primitive components.
// Re-exports and extends audit primitives to avoid duplication.
export { Icon, CovGlyph, DepthBar } from "../audit/primitives";

import type { FC } from "react";

// ── ConfBar ─────────────────────────────────────────────────────────────────

interface ConfBarProps {
  value: number;
  color?: string;
}

export const ConfBar: FC<ConfBarProps> = ({ value, color = "var(--fg-muted)" }) => (
  <div style={{ display: "inline-flex", gap: 1, alignItems: "center" }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <span
        key={i}
        style={{
          width: 3,
          height: 8,
          background: i < Math.round(value * 5) ? color : "var(--fg-whisper)",
        }}
      />
    ))}
  </div>
);
