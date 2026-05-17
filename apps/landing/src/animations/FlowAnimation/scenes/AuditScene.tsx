import { useCurrentFrame, interpolate, Easing, AbsoluteFill, useVideoConfig } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

type VerdictType = "green" | "amber" | "red";

interface ConceptRow {
  name: string;
  verdict: VerdictType;
  label: string;
}

const ROWS: ConceptRow[] = [
  { name: "El análisis tripartito (CVJ)", verdict: "green", label: "cubierto" },
  { name: "Fiabilismo", verdict: "amber", label: "conflicto" },
  { name: "Escepticismo cartesiano", verdict: "green", label: "cubierto" },
  { name: "Principio de cierre", verdict: "amber", label: "parcial" },
  { name: "Coherentismo", verdict: "red", label: "ausente" },
  { name: "Contextualismo (DeRose, Lewis)", verdict: "amber", label: "incompleto" },
  { name: "Injusticia hermenéutica", verdict: "red", label: "ausente" },
  { name: "Virtud epistémica", verdict: "green", label: "cubierto" },
];

const VERDICT_COLORS: Record<VerdictType, { dot: string; pillBg: string; pillFg: string }> = {
  green: { dot: tokens.green, pillBg: tokens.greenTint, pillFg: tokens.greenFg },
  amber: { dot: tokens.amber, pillBg: tokens.amberTint, pillFg: tokens.amberFg },
  red: { dot: tokens.red, pillBg: tokens.redTint, pillFg: tokens.redFg },
};

// Spine proportions
const SPINE_GREEN = 0.488;
const SPINE_AMBER = 0.262;
const SPINE_RED = 0.214;

interface RowItemProps {
  row: ConceptRow;
  index: number;
  frame: number;
}

function RowItem({ row, index, frame }: RowItemProps) {
  const ROW_START = 8;
  const ROW_STAGGER = 6;
  const delay = ROW_START + index * ROW_STAGGER;

  const progress = interpolate(frame, [delay, delay + 20], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  const translateX = interpolate(progress, [0, 1], [20, 0]);
  const colors = VERDICT_COLORS[row.verdict];

  return (
    <div
      style={{
        opacity: progress,
        transform: `translateX(${translateX}px)`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        borderBottom: `1px solid ${tokens.line}`,
      }}
    >
      {/* Coverage dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: colors.dot,
          flexShrink: 0,
        }}
      />

      {/* Concept name */}
      <span
        style={{
          flex: 1,
          fontFamily: tokens.serif,
          fontSize: 12.5,
          color: row.verdict === "red" ? tokens.fgMuted : tokens.fg,
          letterSpacing: "-0.01em",
          fontStyle: row.verdict === "red" ? "italic" : "normal",
        }}
      >
        {row.name}
      </span>

      {/* Verdict pill */}
      <div
        style={{
          background: colors.pillBg,
          color: colors.pillFg,
          fontFamily: tokens.mono,
          fontSize: 9,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "3px 8px",
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        {row.label}
      </div>
    </div>
  );
}

export function AuditScene() {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  // Spine animates after rows settle (~row 8 = delay 8+7*6=50, + 20 = frame 70)
  const spineProgress = interpolate(frame, [64, 110], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  // Spine label opacity
  const spineLabelOpacity = interpolate(frame, [100, 120], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  return (
    <AbsoluteFill
      style={{
        background: tokens.canvas,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 80px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 780 }}>
        {/* Header */}
        <div
          style={{
            fontFamily: tokens.mono,
            fontSize: 9,
            letterSpacing: "0.18em",
            color: tokens.fgFaint,
            textTransform: "uppercase",
            marginBottom: 16,
            opacity: interpolate(frame, [0, 14], [0, 1], { ...clamp(), easing: ease }),
          }}
        >
          auditoría · FIL 411 — Epistemología
        </div>

        {/* Rows container */}
        <div
          style={{
            background: tokens.base,
            border: `1px solid ${tokens.lineStrong}`,
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {/* Column headers */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "6px 14px",
              borderBottom: `1px solid ${tokens.lineStrong}`,
              background: tokens.recessed,
              opacity: interpolate(frame, [0, 12], [0, 1], { ...clamp(), easing: ease }),
            }}
          >
            <div style={{ width: 8, flexShrink: 0 }} />
            <span
              style={{
                flex: 1,
                fontFamily: tokens.mono,
                fontSize: 8.5,
                letterSpacing: "0.12em",
                color: tokens.fgFaint,
                textTransform: "uppercase",
              }}
            >
              concepto
            </span>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 8.5,
                letterSpacing: "0.12em",
                color: tokens.fgFaint,
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              veredicto
            </span>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <RowItem key={row.name} row={row} index={i} frame={frame} />
          ))}
        </div>

        {/* Coverage spine */}
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              opacity: spineLabelOpacity,
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                color: tokens.greenFg,
                letterSpacing: "0.08em",
              }}
            >
              cubierto {Math.round(SPINE_GREEN * 100)}%
            </span>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                color: tokens.amberFg,
                letterSpacing: "0.08em",
              }}
            >
              parcial {Math.round(SPINE_AMBER * 100)}%
            </span>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                color: tokens.redFg,
                letterSpacing: "0.08em",
              }}
            >
              ausente {Math.round(SPINE_RED * 100)}%
            </span>
          </div>

          {/* Spine bar */}
          <div
            style={{
              height: 6,
              background: tokens.recessed,
              borderRadius: 3,
              overflow: "hidden",
              display: "flex",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${spineProgress * SPINE_GREEN * 100}%`,
                background: tokens.green,
                borderRadius: "3px 0 0 3px",
              }}
            />
            <div
              style={{
                height: "100%",
                width: `${spineProgress * SPINE_AMBER * 100}%`,
                background: tokens.amber,
              }}
            />
            <div
              style={{
                height: "100%",
                width: `${spineProgress * SPINE_RED * 100}%`,
                background: tokens.red,
                borderRadius: "0 3px 3px 0",
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
