import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(v: number): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

interface SourceCardProps {
  label: string;
  sublabel: string;
  delay: number;
  frame: number;
  accentColor?: string;
}

function SourceCard({ label, sublabel, delay, frame, accentColor = tokens.accentSoft }: SourceCardProps) {
  const progress = interpolate(frame, [delay, delay + 22], [0, 1], {
    ...clamp(0),
    easing: ease,
  });
  const opacity = progress;
  const translateY = interpolate(progress, [0, 1], [18, 0]);

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        background: tokens.base,
        border: `1px solid ${tokens.lineStrong}`,
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: tokens.recessed,
          border: `1px solid ${tokens.lineStrong}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 2,
            background: accentColor,
            opacity: 0.85,
          }}
        />
      </div>
      <div>
        <div
          style={{
            fontFamily: tokens.sans,
            fontSize: 12,
            fontWeight: 600,
            color: tokens.fg,
            letterSpacing: "0.01em",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: tokens.mono,
            fontSize: 10,
            color: tokens.fgMuted,
            marginTop: 2,
            letterSpacing: "0.04em",
          }}
        >
          {sublabel}
        </div>
      </div>
    </div>
  );
}

interface FragmentProps {
  text: string;
  delay: number;
  frame: number;
  xOffset: number;
}

function Fragment({ text, delay, frame, xOffset }: FragmentProps) {
  const progress = interpolate(frame, [delay, delay + 18], [0, 1], {
    ...clamp(0),
    easing: ease,
  });
  const translateY = interpolate(progress, [0, 1], [-8, 0]);

  return (
    <div
      style={{
        opacity: progress * 0.72,
        transform: `translateY(${translateY}px) translateX(${xOffset}px)`,
        fontFamily: tokens.mono,
        fontSize: 9.5,
        color: tokens.fgMuted,
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
        marginBottom: 6,
      }}
    >
      {text}
    </div>
  );
}

export function IngestScene() {
  const frame = useCurrentFrame();

  const FRAGMENTS = [
    { text: "frag · 0001  ·  concepto: epistemología", delay: 28, x: 0 },
    { text: "frag · 0047  ·  cita: BonJour 1985, p.87", delay: 36, x: 6 },
    { text: "frag · 0112  ·  concepto: justificación", delay: 44, x: -4 },
    { text: "frag · 0198  ·  cita: Gettier 1963, p.121", delay: 52, x: 8 },
    { text: "frag · 0203  ·  concepto: fiabilismo", delay: 58, x: 0 },
    { text: "frag · 0247  ·  cita: Sosa 1991, §3", delay: 64, x: 4 },
  ];

  // Corpus pill fill
  const corpusProgress = interpolate(frame, [68, 96], [0, 1], {
    ...clamp(0),
    easing: ease,
  });

  // Count tick
  const countOpacity = interpolate(frame, [88, 104], [0, 1], {
    ...clamp(0),
    easing: ease,
  });

  // Connection line opacity — arrow from cards to corpus
  const lineOpacity = interpolate(frame, [40, 56], [0, 1], {
    ...clamp(0),
    easing: ease,
  });

  return (
    <AbsoluteFill
      style={{
        background: tokens.canvas,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 60px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 40,
          width: "100%",
          maxWidth: 1060,
        }}
      >
        {/* Left: source cards */}
        <div style={{ flex: "0 0 220px" }}>
          <SourceCard
            label="Notion — FIL 411"
            sublabel="notas · 312 páginas"
            delay={6}
            frame={frame}
            accentColor={tokens.accentSoft}
          />
          <SourceCard
            label="fil411_v3.pdf"
            sublabel="programa · syllabus"
            delay={18}
            frame={frame}
            accentColor={tokens.amberFg}
          />
          <SourceCard
            label="bibliografía.txt"
            sublabel="14 fuentes · reading list"
            delay={28}
            frame={frame}
            accentColor={tokens.greenFg}
          />
        </div>

        {/* Center: connection + fragments */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0,
          }}
        >
          {/* Arrow line */}
          <div
            style={{
              opacity: lineOpacity,
              width: "100%",
              height: 1,
              background: `linear-gradient(to right, ${tokens.lineStrong}, ${tokens.accent}40, ${tokens.lineStrong})`,
              marginBottom: 18,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: -4,
                top: -3,
                width: 7,
                height: 7,
                borderTop: `1px solid ${tokens.accent}80`,
                borderRight: `1px solid ${tokens.accent}80`,
                transform: "rotate(45deg)",
              }}
            />
          </div>

          {/* Fragments cascade */}
          <div style={{ width: "100%", padding: "0 8px" }}>
            {FRAGMENTS.map((f) => (
              <Fragment key={f.text} text={f.text} delay={f.delay} frame={frame} xOffset={f.x} />
            ))}
          </div>
        </div>

        {/* Right: corpus pill */}
        <div style={{ flex: "0 0 200px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Corpus container */}
          <div
            style={{
              background: tokens.base,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 10,
              padding: "16px",
              opacity: interpolate(frame, [30, 46], [0, 1], { ...clamp(0), easing: ease }),
            }}
          >
            <div
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                letterSpacing: "0.18em",
                color: tokens.fgFaint,
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              corpus
            </div>

            {/* Fill bar */}
            <div
              style={{
                height: 4,
                background: tokens.recessed,
                borderRadius: 2,
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${corpusProgress * 100}%`,
                  background: `linear-gradient(to right, ${tokens.accent}80, ${tokens.accentSoft})`,
                  borderRadius: 2,
                }}
              />
            </div>

            {/* Fragment count */}
            <div
              style={{
                fontFamily: tokens.mono,
                fontSize: 11,
                color: tokens.fgMuted,
                letterSpacing: "0.04em",
              }}
            >
              {Math.round(corpusProgress * 247)} frag
            </div>
          </div>

          {/* Final count tick */}
          <div
            style={{
              opacity: countOpacity,
              background: tokens.recessed,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <div
              style={{
                fontFamily: tokens.mono,
                fontSize: 10,
                color: tokens.greenFg,
                letterSpacing: "0.06em",
                lineHeight: 1.6,
              }}
            >
              <div>247 fragmentos</div>
              <div>84 conceptos</div>
              <div style={{ color: tokens.fgFaint, marginTop: 4 }}>
                › análisis completado
              </div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
