import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

interface SourceCardProps {
  label: string;
  sublabel: string;
  tag: string;
  delay: number;
  frame: number;
  accentColor: string;
  progressDelay: number;
  progressDuration: number;
  icon: "pdf" | "txt";
}

function SourceCard({
  label,
  sublabel,
  tag,
  delay,
  frame,
  accentColor,
  progressDelay,
  progressDuration,
  icon,
}: SourceCardProps) {
  const entrance = interpolate(frame, [delay, delay + 22], [0, 1], {
    ...clamp(),
    easing: ease,
  });
  const translateY = interpolate(entrance, [0, 1], [18, 0]);

  const barProgress = interpolate(
    frame,
    [progressDelay, progressDelay + progressDuration],
    [0, 1],
    { ...clamp(), easing: ease }
  );

  // Done tick
  const doneOpacity = interpolate(
    frame,
    [progressDelay + progressDuration, progressDelay + progressDuration + 12],
    [0, 1],
    { ...clamp(), easing: ease }
  );

  return (
    <div
      style={{
        opacity: entrance,
        transform: `translateY(${translateY}px)`,
        background: tokens.base,
        border: `1px solid ${tokens.lineStrong}`,
        borderRadius: 10,
        padding: "16px 18px",
        marginBottom: 12,
      }}
    >
      {/* Card header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        {/* File icon */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 7,
            background: tokens.recessed,
            border: `1px solid ${tokens.lineStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: tokens.mono,
              fontSize: 8,
              letterSpacing: "0.04em",
              color: accentColor,
              fontWeight: 600,
            }}
          >
            {icon === "pdf" ? "PDF" : "TXT"}
          </span>
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              fontFamily: tokens.sans,
              fontSize: 12,
              fontWeight: 600,
              color: tokens.fg,
              letterSpacing: "0.01em",
              marginBottom: 2,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: tokens.mono,
              fontSize: 9.5,
              color: tokens.fgMuted,
              letterSpacing: "0.04em",
            }}
          >
            {sublabel}
          </div>
        </div>

        {/* Tag pill */}
        <div
          style={{
            background: tokens.recessed,
            border: `1px solid ${tokens.lineStrong}`,
            borderRadius: 4,
            padding: "3px 8px",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: tokens.mono,
              fontSize: 8.5,
              letterSpacing: "0.1em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
            }}
          >
            {tag}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span
            style={{
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.08em",
              color: tokens.fgFaint,
            }}
          >
            procesando
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                letterSpacing: "0.06em",
                color: barProgress >= 1 ? tokens.greenFg : accentColor,
              }}
            >
              {Math.round(barProgress * 100)}%
            </span>
            {/* Done checkmark */}
            {doneOpacity > 0 && (
              <div
                style={{
                  opacity: doneOpacity,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: tokens.greenTint,
                  border: `1px solid ${tokens.greenFg}50`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 2.5,
                    borderLeft: `1.5px solid ${tokens.greenFg}`,
                    borderBottom: `1.5px solid ${tokens.greenFg}`,
                    transform: "rotate(-45deg) translateY(-0.5px)",
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            height: 4,
            background: tokens.recessed,
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${barProgress * 100}%`,
              background:
                barProgress >= 1
                  ? `linear-gradient(to right, ${tokens.green}80, ${tokens.greenFg})`
                  : `linear-gradient(to right, ${accentColor}60, ${accentColor})`,
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function LoadingScene() {
  const frame = useCurrentFrame();

  // Scene header
  const headerOpacity = interpolate(frame, [0, 16], [0, 1], { ...clamp(), easing: ease });

  // Corpus counter
  const fragCount = Math.round(
    interpolate(frame, [65, 100], [0, 247], { ...clamp(), easing: ease })
  );
  const conceptCount = Math.round(
    interpolate(frame, [72, 105], [0, 84], { ...clamp(), easing: ease })
  );

  // Corpus box
  const corpusOpacity = interpolate(frame, [58, 74], [0, 1], { ...clamp(), easing: ease });

  // Fragment lines appearing in the corpus box
  const fragLine1Opacity = interpolate(frame, [70, 82], [0, 1], { ...clamp(), easing: ease });
  const fragLine2Opacity = interpolate(frame, [80, 92], [0, 1], { ...clamp(), easing: ease });
  const fragLine3Opacity = interpolate(frame, [90, 102], [0, 1], { ...clamp(), easing: ease });

  // Final tick
  const doneOpacity = interpolate(frame, [108, 118], [0, 1], { ...clamp(), easing: ease });

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
          alignItems: "flex-start",
          gap: 36,
          width: "100%",
          maxWidth: 980,
        }}
      >
        {/* Left: source cards */}
        <div style={{ flex: "0 0 360px" }}>
          <div
            style={{
              opacity: headerOpacity,
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            fuentes del programa
          </div>

          <SourceCard
            label="fil411_v3.pdf"
            sublabel="programa · syllabus oficial"
            tag="programa"
            delay={12}
            frame={frame}
            accentColor={tokens.amberFg}
            progressDelay={26}
            progressDuration={42}
            icon="pdf"
          />

          <SourceCard
            label="bibliografía.txt"
            sublabel="14 fuentes · reading list"
            tag="bibliografía"
            delay={24}
            frame={frame}
            accentColor={tokens.greenFg}
            progressDelay={48}
            progressDuration={38}
            icon="txt"
          />
        </div>

        {/* Arrow */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            paddingTop: 80,
            opacity: interpolate(frame, [36, 52], [0, 1], { ...clamp(), easing: ease }),
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 40,
                height: 1,
                background: `linear-gradient(to right, ${tokens.lineStrong}, ${tokens.accent}50)`,
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
                  borderTop: `1px solid ${tokens.accent}70`,
                  borderRight: `1px solid ${tokens.accent}70`,
                  transform: "rotate(45deg)",
                }}
              />
            </div>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 8,
                letterSpacing: "0.08em",
                color: tokens.fgFaint,
              }}
            >
              indexando
            </span>
          </div>
        </div>

        {/* Right: corpus result */}
        <div
          style={{
            flex: 1,
            opacity: corpusOpacity,
          }}
        >
          <div
            style={{
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            corpus de referencia
          </div>

          <div
            style={{
              background: tokens.base,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Stats row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1,
                background: tokens.lineStrong,
                borderBottom: `1px solid ${tokens.lineStrong}`,
              }}
            >
              {[
                { num: fragCount, label: "fragmentos" },
                { num: conceptCount, label: "conceptos" },
              ].map(({ num, label }) => (
                <div key={label} style={{ background: tokens.recessed, padding: "14px 16px" }}>
                  <div
                    style={{
                      fontFamily: tokens.sans,
                      fontWeight: 600,
                      fontSize: 24,
                      color: tokens.fg,
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                      marginBottom: 4,
                    }}
                  >
                    {num}
                  </div>
                  <div
                    style={{
                      fontFamily: tokens.mono,
                      fontSize: 9,
                      color: tokens.fgFaint,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Fragment preview lines */}
            <div style={{ padding: "12px 16px" }}>
              <div
                style={{
                  opacity: fragLine1Opacity,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.fgMuted,
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                frag · 0001 · tema: epistemología
              </div>
              <div
                style={{
                  opacity: fragLine2Opacity,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.fgMuted,
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                frag · 0047 · cita: BonJour 1985, p.87
              </div>
              <div
                style={{
                  opacity: fragLine3Opacity,
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.fgMuted,
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                frag · 0112 · concepto: justificación
              </div>
              <div
                style={{
                  opacity: fragLine3Opacity * 0.5,
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  color: tokens.fgFaint,
                  letterSpacing: "0.06em",
                }}
              >
                ··· 244 fragmentos más
              </div>
            </div>

            {/* Done stamp */}
            <div
              style={{
                opacity: doneOpacity,
                borderTop: `1px solid ${tokens.lineStrong}`,
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `rgba(77, 139, 106, 0.06)`,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  border: `1.5px solid ${tokens.greenFg}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 2.5,
                    borderLeft: `1.5px solid ${tokens.greenFg}`,
                    borderBottom: `1.5px solid ${tokens.greenFg}`,
                    transform: "rotate(-45deg) translateY(-0.5px)",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9.5,
                  color: tokens.greenFg,
                  letterSpacing: "0.08em",
                }}
              >
                247 fragmentos · 84 conceptos indexados
              </span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
