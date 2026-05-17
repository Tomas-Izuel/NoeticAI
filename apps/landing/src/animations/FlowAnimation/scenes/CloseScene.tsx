import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

// The paragraph to type out
const PARAGRAPH_BEFORE_CITE =
  "El coherentismo rechaza la asimetría fundacionalista entre creencias básicas y no básicas. La justificación surge del apoyo mutuo entre creencias en un sistema holístico ";
const CITE = "[BonJour 1985, §5]";
const PARAGRAPH_AFTER = ".";

const FULL_TEXT = PARAGRAPH_BEFORE_CITE + CITE + PARAGRAPH_AFTER;

// Spine proportions — carried over from Audit
const SPINE_GREEN = 0.488;
const SPINE_AMBER = 0.262;
const SPINE_RED = 0.214;

export function CloseScene() {
  const frame = useCurrentFrame();

  // Stats trio fade-in
  const statsOpacity = interpolate(frame, [0, 16], [0, 1], {
    ...clamp(),
    easing: ease,
  });
  const statsTranslateY = interpolate(frame, [0, 16], [12, 0], {
    ...clamp(),
    easing: ease,
  });

  // Spine opacity
  const spineOpacity = interpolate(frame, [10, 26], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  // Drafting card entrance
  const cardOpacity = interpolate(frame, [14, 30], [0, 1], {
    ...clamp(),
    easing: ease,
  });
  const cardTranslateX = interpolate(frame, [14, 30], [24, 0], {
    ...clamp(),
    easing: ease,
  });

  // Typewriter: runs from frame 32 to frame 100 (68 frames for the text)
  const TYPEWRITER_START = 32;
  const TYPEWRITER_END = 100;
  const charProgress = interpolate(frame, [TYPEWRITER_START, TYPEWRITER_END], [0, FULL_TEXT.length], {
    ...clamp(),
    easing: Easing.linear,
  });
  const visibleChars = Math.round(charProgress);

  const beforeCiteLength = PARAGRAPH_BEFORE_CITE.length;
  const citeEnd = beforeCiteLength + CITE.length;

  // What's visible of each segment
  const visibleBefore = FULL_TEXT.substring(0, Math.min(visibleChars, beforeCiteLength));
  const visibleCite =
    visibleChars > beforeCiteLength
      ? CITE.substring(0, Math.min(visibleChars - beforeCiteLength, CITE.length))
      : "";
  const visibleAfter =
    visibleChars > citeEnd ? PARAGRAPH_AFTER.substring(0, visibleChars - citeEnd) : "";

  // Cite highlight comes in as text is typed
  const citeHighlightOpacity =
    visibleChars >= beforeCiteLength + CITE.length
      ? interpolate(frame, [TYPEWRITER_END - 8, TYPEWRITER_END], [0, 1], {
          ...clamp(),
          easing: ease,
        })
      : 0;

  // Confidence row appears after typing completes
  const confidenceOpacity = interpolate(frame, [104, 116], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  // Stamp appears last
  const stampOpacity = interpolate(frame, [110, 118], [0, 1], {
    ...clamp(),
    easing: ease,
  });
  const stampScale = interpolate(frame, [110, 118], [0.92, 1], {
    ...clamp(),
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
          display: "grid",
          gridTemplateColumns: "1fr 1.4fr",
          gap: 40,
          width: "100%",
          maxWidth: 1060,
          alignItems: "start",
        }}
      >
        {/* Left: stats + spine */}
        <div>
          <div
            style={{
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: "0.18em",
              color: tokens.fgFaint,
              textTransform: "uppercase",
              marginBottom: 16,
              opacity: statsOpacity,
            }}
          >
            mapa de cobertura
          </div>

          {/* Stats trio */}
          <div
            style={{
              opacity: statsOpacity,
              transform: `translateY(${statsTranslateY}px)`,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 1,
              background: tokens.lineStrong,
              border: `1px solid ${tokens.lineStrong}`,
              borderRadius: 8,
              overflow: "hidden",
              marginBottom: 16,
            }}
          >
            {[
              { num: "41", label: "Cubierto", dotColor: tokens.green },
              { num: "22", label: "Incompleto", dotColor: tokens.amber },
              { num: "18", label: "Ausente", dotColor: tokens.red },
            ].map(({ num, label, dotColor }) => (
              <div
                key={label}
                style={{
                  background: tokens.base,
                  padding: "14px 12px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: tokens.sans,
                    fontSize: 26,
                    fontWeight: 600,
                    color: tokens.fg,
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
                      background: dotColor,
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

          {/* Coverage spine */}
          <div style={{ opacity: spineOpacity }}>
            <div
              style={{
                height: 5,
                background: tokens.recessed,
                borderRadius: 3,
                overflow: "hidden",
                display: "flex",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${SPINE_GREEN * 100}%`,
                  background: tokens.green,
                  borderRadius: "3px 0 0 3px",
                }}
              />
              <div
                style={{
                  height: "100%",
                  width: `${SPINE_AMBER * 100}%`,
                  background: tokens.amber,
                }}
              />
              <div
                style={{
                  height: "100%",
                  width: `${SPINE_RED * 100}%`,
                  background: tokens.red,
                  borderRadius: "0 3px 3px 0",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                color: tokens.fgFaint,
                letterSpacing: "0.06em",
              }}
            >
              48.8% cubierto · 26.2% parcial · 21.4% ausente
            </div>
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
                  background: tokens.red,
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
                cerrando · Coherentismo
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
                      color: citeHighlightOpacity > 0
                        ? tokens.accentSoft
                        : tokens.fgMuted,
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
                  opacity: confidenceOpacity,
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
                {/* Bar */}
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    gap: 2,
                  }}
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 1,
                        background: i < 7 ? tokens.greenFg : tokens.fgWhisper,
                        opacity: i < 7 ? 0.7 : 0.3,
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
                  0,94
                </span>
              </div>
            </div>

            {/* Stamp */}
            <div
              style={{
                opacity: stampOpacity,
                transform: `scale(${stampScale})`,
                borderTop: `1px solid ${tokens.lineStrong}`,
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: `rgba(77, 139, 106, 0.06)`,
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
                    height: 5,
                    borderRadius: "50%",
                    background: tokens.greenFg,
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
                borrador listo
              </span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
