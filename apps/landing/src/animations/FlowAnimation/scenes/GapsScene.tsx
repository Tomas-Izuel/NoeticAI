import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

type VerdictType = "cubierto" | "parcial" | "ausente";

interface ConceptRow {
  name: string;
  verdict: VerdictType;
}

const ROWS: ConceptRow[] = [
  { name: "El análisis tripartito (CVJ)", verdict: "cubierto" },
  { name: "Fiabilismo", verdict: "parcial" },
  { name: "Escepticismo cartesiano", verdict: "cubierto" },
  { name: "Principio de cierre", verdict: "parcial" },
  { name: "Coherentismo", verdict: "ausente" },
  { name: "Contextualismo (DeRose, Lewis)", verdict: "parcial" },
  { name: "Injusticia hermenéutica", verdict: "ausente" },
  { name: "Virtud epistémica", verdict: "cubierto" },
];

const VERDICT_LABELS: Record<VerdictType, string> = {
  cubierto: "cubierto",
  parcial: "parcial",
  ausente: "ausente",
};

const VERDICT_COLORS: Record<
  VerdictType,
  { dot: string; pillBg: string; pillFg: string; rowBg: string }
> = {
  cubierto: {
    dot: tokens.green,
    pillBg: tokens.greenTint,
    pillFg: tokens.greenFg,
    rowBg: "transparent",
  },
  parcial: {
    dot: tokens.amber,
    pillBg: tokens.amberTint,
    pillFg: tokens.amberFg,
    rowBg: `rgba(192, 138, 62, 0.04)`,
  },
  ausente: {
    dot: tokens.red,
    pillBg: tokens.redTint,
    pillFg: tokens.redFg,
    rowBg: `rgba(168, 34, 27, 0.07)`,
  },
};

// Count rows by verdict for spine proportions
const greenCount = ROWS.filter((r) => r.verdict === "cubierto").length;
const amberCount = ROWS.filter((r) => r.verdict === "parcial").length;
const redCount = ROWS.filter((r) => r.verdict === "ausente").length;
const total = ROWS.length;
const SPINE_GREEN = greenCount / total;
const SPINE_AMBER = amberCount / total;
const SPINE_RED = redCount / total;

interface RowItemProps {
  row: ConceptRow;
  index: number;
  frame: number;
  totalFrames: number;
}

function RowItem({ row, index, frame, totalFrames }: RowItemProps) {
  const ROW_START = 10;
  const ROW_STAGGER = 7;
  const delay = ROW_START + index * ROW_STAGGER;

  const progress = interpolate(frame, [delay, delay + 22], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  const translateX = interpolate(progress, [0, 1], [16, 0]);
  const colors = VERDICT_COLORS[row.verdict];

  // "Ausente" rows pulse in color during the later part of the scene
  // to draw attention to the gaps
  const isProblem = row.verdict === "ausente" || row.verdict === "parcial";
  const pulseStart = 90;
  const pulsePhase = interpolate(
    frame,
    [pulseStart, pulseStart + 30, pulseStart + 60, pulseStart + 90],
    [0, 1, 0, 0],
    { ...clamp(), easing: Easing.linear }
  );

  // Only pulse red rows — amber rows don't pulse
  const pulseOpacity =
    row.verdict === "ausente"
      ? interpolate(pulsePhase, [0, 0.5, 1], [0, 0.12, 0])
      : 0;

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
        background: colors.rowBg,
        position: "relative",
      }}
    >
      {/* Pulse overlay for gap rows */}
      {isProblem && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: row.verdict === "ausente" ? tokens.redTint : "transparent",
            opacity: pulseOpacity * 2,
            pointerEvents: "none",
          }}
        />
      )}

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
          color:
            row.verdict === "ausente"
              ? tokens.fgMuted
              : row.verdict === "parcial"
                ? tokens.fg
                : tokens.fg,
          letterSpacing: "-0.01em",
          fontStyle: row.verdict === "ausente" ? "italic" : "normal",
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
          border: row.verdict === "ausente" ? `1px solid ${tokens.red}40` : "1px solid transparent",
        }}
      >
        {VERDICT_LABELS[row.verdict]}
      </div>
    </div>
  );
}

// Gap callout that appears after all rows render
function GapCallout({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [80, 96], [0, 1], { ...clamp(), easing: ease });
  const translateY = interpolate(frame, [80, 96], [8, 0], { ...clamp(), easing: ease });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        marginTop: 10,
        background: tokens.redTint,
        border: `1px solid ${tokens.red}40`,
        borderRadius: 7,
        padding: "8px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: tokens.red,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: tokens.mono,
          fontSize: 9.5,
          color: tokens.redFg,
          letterSpacing: "0.06em",
        }}
      >
        2 conceptos ausentes · 3 parcialmente cubiertos
      </span>
    </div>
  );
}

export function GapsScene() {
  const frame = useCurrentFrame();

  // Header
  const headerOpacity = interpolate(frame, [0, 14], [0, 1], { ...clamp(), easing: ease });

  // Spine animates after rows settle (~row 8 = 10 + 7*7 = 59 + 22 = frame 81)
  const spineProgress = interpolate(frame, [72, 118], [0, 1], { ...clamp(), easing: ease });
  const spineLabelOpacity = interpolate(frame, [108, 128], [0, 1], { ...clamp(), easing: ease });

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
            opacity: headerOpacity,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
            }}
          >
            vacíos detectados · FIL 411
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: tokens.redTint,
              border: `1px solid ${tokens.red}30`,
              borderRadius: 4,
              padding: "3px 10px",
            }}
          >
            <div
              style={{ width: 6, height: 6, borderRadius: "50%", background: tokens.red }}
            />
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 8.5,
                letterSpacing: "0.1em",
                color: tokens.redFg,
                textTransform: "uppercase",
              }}
            >
              vacíos detectados
            </span>
          </div>
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
              concepto del programa
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
              cobertura
            </span>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <RowItem
              key={row.name}
              row={row}
              index={i}
              frame={frame}
              totalFrames={150}
            />
          ))}
        </div>

        {/* Gap callout */}
        <GapCallout frame={frame} />

        {/* Coverage spine */}
        <div style={{ marginTop: 12 }}>
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
