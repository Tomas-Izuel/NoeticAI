import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

// The gap concept being closed via typewriter
const PARAGRAPH_BEFORE_CITE =
  "El coherentismo (BonJour) rechaza la asimetría fundacionalista: la justificación surge del apoyo mutuo entre creencias en un sistema holístico ";
const CITE = "[BonJour 1985, §5]";
const PARAGRAPH_AFTER = ".";
const FULL_TEXT = PARAGRAPH_BEFORE_CITE + CITE + PARAGRAPH_AFTER;

// Spine end state: 100% green (all gaps closed)
const SPINE_GREEN_FINAL = 1.0;

export function CompletionScene() {
  const frame = useCurrentFrame();

  // Stats fade-in
  const statsOpacity = interpolate(frame, [0, 18], [0, 1], { ...clamp(), easing: ease });
  const statsTranslateY = interpolate(frame, [0, 18], [14, 0], { ...clamp(), easing: ease });

  // Spine opacity
  const spineOpacity = interpolate(frame, [12, 28], [0, 1], { ...clamp(), easing: ease });

  // Spine fills to 100% green
  const spineProgress = interpolate(frame, [14, 60], [0, SPINE_GREEN_FINAL], {
    ...clamp(),
    easing: ease,
  });

  // Drafting card entrance
  const cardOpacity = interpolate(frame, [16, 32], [0, 1], { ...clamp(), easing: ease });
  const cardTranslateX = interpolate(frame, [16, 32], [24, 0], { ...clamp(), easing: ease });

  // Typewriter: runs from frame 34 to ~105
  const TYPEWRITER_START = 34;
  const TYPEWRITER_END = 104;
  const charProgress = interpolate(
    frame,
    [TYPEWRITER_START, TYPEWRITER_END],
    [0, FULL_TEXT.length],
    { ...clamp(), easing: Easing.linear }
  );
  const visibleChars = Math.round(charProgress);

  const beforeCiteLength = PARAGRAPH_BEFORE_CITE.length;
  const citeEnd = beforeCiteLength + CITE.length;

  const visibleBefore = FULL_TEXT.substring(0, Math.min(visibleChars, beforeCiteLength));
  const visibleCite =
    visibleChars > beforeCiteLength
      ? CITE.substring(0, Math.min(visibleChars - beforeCiteLength, CITE.length))
      : "";
  const visibleAfter =
    visibleChars > citeEnd ? PARAGRAPH_AFTER.substring(0, visibleChars - citeEnd) : "";

  const citeHighlightOpacity =
    visibleChars >= beforeCiteLength + CITE.length
      ? interpolate(frame, [TYPEWRITER_END - 8, TYPEWRITER_END], [0, 1], {
          ...clamp(),
          easing: ease,
        })
      : 0;

  // Zero-gaps badge
  const zeroGapsOpacity = interpolate(frame, [108, 120], [0, 1], { ...clamp(), easing: ease });
  const zeroGapsScale = interpolate(frame, [108, 120], [0.9, 1], { ...clamp(), easing: ease });

  // Final stamp
  const stampOpacity = interpolate(frame, [112, 120], [0, 1], { ...clamp(), easing: ease });
  const stampScale = interpolate(frame, [112, 120], [0.92, 1], { ...clamp(), easing: ease });

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
          display: "grid",
          gridTemplateColumns: "1fr 1.5fr",
          gap: 40,
          width: "100%",
          maxWidth: 1060,
          alignItems: "start",
        }}
      >
        {/* Left: stats + zero-gaps badge + spine */}
        <div>
          <div
            style={{
              opacity: statsOpacity,
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
              marginBottom: 16,
            }}
          >
            mapa de cobertura
          </div>

          {/* Stats grid */}
          <div
            style={{
              opacity: statsOpacity,
              transform: `translateY(${statsTranslateY}px)`,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1,
              background: tokens.lineStrong,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 14,
            }}
          >
            {[
              { num: "8", label: "Cubiertos", dotColor: tokens.green },
              { num: "0", label: "Vacíos", dotColor: tokens.red },
            ].map(({ num, label, dotColor }) => (
              <div key={label} style={{ background: tokens.base, padding: "14px 12px", textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: tokens.sans,
                    fontSize: 28,
                    fontWeight: 600,
                    color: num === "0" ? tokens.greenFg : tokens.fg,
                    lineHeight: 1,
                    letterSpacing: "-0.02em",
                    marginBottom: 6,
                  }}
                >
                  {num}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: num === "0" ? tokens.green : dotColor,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: tokens.sans,
                      fontSize: 10,
                      color: tokens.fgMuted,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {label}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 100% coverage spine */}
          <div style={{ opacity: spineOpacity }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  color: tokens.greenFg,
                  letterSpacing: "0.08em",
                }}
              >
                100% cubierto
              </span>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  color: tokens.fgFaint,
                  letterSpacing: "0.08em",
                }}
              >
                0 vacíos
              </span>
            </div>
            <div
              style={{
                height: 6,
                background: tokens.recessed,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${spineProgress * 100}%`,
                  background: `linear-gradient(to right, ${tokens.green}80, ${tokens.greenFg})`,
                  borderRadius: 3,
                }}
              />
            </div>
          </div>

          {/* Zero-gaps badge */}
          <div
            style={{
              opacity: zeroGapsOpacity,
              transform: `scale(${zeroGapsScale})`,
              marginTop: 14,
              background: tokens.greenTint,
              border: `1px solid ${tokens.greenFg}40`,
              borderRadius: 7,
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
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
                  width: 5,
                  height: 3,
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
              0 vacíos · syllabus cubierto
            </span>
          </div>
        </div>

        {/* Right: drafting card */}
        <div
          style={{
            opacity: cardOpacity,
            transform: `translateX(${cardTranslateX}px)`,
          }}
        >
          <div
            style={{
              background: tokens.base,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {/* Card header */}
            <div
              style={{
                background: tokens.recessed,
                borderBottom: `1px solid ${tokens.lineStrong}`,
                padding: "8px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: tokens.greenFg,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  color: tokens.fgFaint,
                  textTransform: "uppercase",
                }}
              >
                completando · Coherentismo
              </span>
            </div>

            {/* Typewriter content */}
            <div style={{ padding: "18px 18px 14px" }}>
              <p
                style={{
                  fontFamily: tokens.serif,
                  fontSize: 13.5,
                  lineHeight: 1.65,
                  color: tokens.fg,
                  margin: 0,
                  letterSpacing: "-0.005em",
                  minHeight: 88,
                }}
              >
                {visibleBefore}
                {visibleCite && (
                  <span
                    style={{
                      background:
                        citeHighlightOpacity > 0
                          ? `rgba(168, 34, 27, ${0.22 * citeHighlightOpacity})`
                          : "transparent",
                      color:
                        citeHighlightOpacity > 0 ? tokens.accentSoft : tokens.fgMuted,
                      borderRadius: 3,
                      padding: "0 2px",
                      fontFamily: tokens.mono,
                      fontSize: 12,
                    }}
                  >
                    {visibleCite}
                  </span>
                )}
                {visibleAfter}
                {/* Cursor */}
                {visibleChars < FULL_TEXT.length && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 1,
                      height: "1em",
                      background: tokens.fgMuted,
                      marginLeft: 1,
                      verticalAlign: "text-bottom",
                      opacity: frame % 20 < 10 ? 1 : 0,
                    }}
                  />
                )}
              </p>

              {/* Confidence row */}
              <div
                style={{
                  opacity: interpolate(frame, [106, 118], [0, 1], { ...clamp(), easing: ease }),
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: `1px solid ${tokens.line}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    fontFamily: tokens.mono,
                    fontSize: 9,
                    letterSpacing: "0.1em",
                    color: tokens.fgFaint,
                    textTransform: "uppercase",
                    flexShrink: 0,
                  }}
                >
                  confianza
                </span>
                <div style={{ flex: 1, display: "flex", gap: 2 }}>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 1,
                        background: tokens.greenFg,
                        opacity: 0.7,
                      }}
                    />
                  ))}
                </div>
                <span
                  style={{
                    fontFamily: tokens.mono,
                    fontSize: 10,
                    color: tokens.greenFg,
                    letterSpacing: "0.04em",
                    flexShrink: 0,
                  }}
                >
                  1,00
                </span>
              </div>
            </div>

            {/* Final stamp */}
            <div
              style={{
                opacity: stampOpacity,
                transform: `scale(${stampScale})`,
                borderTop: `1px solid ${tokens.lineStrong}`,
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `rgba(77, 139, 106, 0.08)`,
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
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
                    width: 5,
                    height: 3,
                    borderLeft: `1.5px solid ${tokens.greenFg}`,
                    borderBottom: `1.5px solid ${tokens.greenFg}`,
                    transform: "rotate(-45deg) translateY(-0.5px)",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 10,
                  color: tokens.greenFg,
                  letterSpacing: "0.08em",
                }}
              >
                borrador listo · syllabus cubierto
              </span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
