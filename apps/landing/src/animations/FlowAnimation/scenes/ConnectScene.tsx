import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const easeOut = Easing.bezier(0.0, 0.0, 0.2, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

// Notion N mark (same as NotionNotesScene)
function NotionMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="16" height="16" rx="3" fill="#191919" />
      <text
        x="8"
        y="12"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="bold"
        fontSize="11"
        fill="#FFFFFF"
      >
        N
      </text>
    </svg>
  );
}

// Animated pulse dot for the connection line
function PulseDot({ frame, offset }: { frame: number; offset: number }) {
  // Dot travels along the line: repeating cycle every 40 frames
  const cycle = ((frame + offset) % 40) / 40;
  const x = interpolate(cycle, [0, 1], [0, 100]); // percentage along line

  const opacity = interpolate(cycle, [0, 0.1, 0.85, 1], [0, 1, 1, 0], {
    ...clamp(),
    easing: Easing.linear,
  });

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: `${x}%`,
        transform: "translate(-50%, -50%)",
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: tokens.accentSoft,
        opacity,
        boxShadow: `0 0 6px ${tokens.accent}`,
      }}
    />
  );
}

export function ConnectScene() {
  const frame = useCurrentFrame();

  // Left Notion card entrance
  const notionOpacity = interpolate(frame, [0, 22], [0, 1], { ...clamp(), easing: ease });
  const notionTranslateX = interpolate(frame, [0, 22], [-24, 0], { ...clamp(), easing: ease });

  // Right NoeticAI card entrance — slight delay
  const noeticOpacity = interpolate(frame, [14, 36], [0, 1], { ...clamp(), easing: ease });
  const noeticTranslateX = interpolate(frame, [14, 36], [24, 0], { ...clamp(), easing: ease });

  // Connection line draws from left to right
  const lineProgress = interpolate(frame, [28, 60], [0, 1], { ...clamp(), easing: easeOut });

  // Status pill appears after line is fully drawn
  const pillOpacity = interpolate(frame, [64, 80], [0, 1], { ...clamp(), easing: ease });
  const pillScale = interpolate(frame, [64, 80], [0.88, 1], { ...clamp(), easing: ease });

  // Sync icon rotation pulse
  const syncRotation = interpolate(frame, [64, 104], [0, 360], {
    ...clamp(),
    easing: Easing.linear,
  });

  // Dots only travel after line is visible
  const dotsVisible = lineProgress > 0.8;

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
          gap: 0,
          width: "100%",
          maxWidth: 900,
        }}
      >
        {/* Left: Notion card */}
        <div
          style={{
            opacity: notionOpacity,
            transform: `translateX(${notionTranslateX}px)`,
            flex: "0 0 260px",
            background: "#FFFFFF",
            borderRadius: 10,
            overflow: "hidden",
            border: "1px solid rgba(0,0,0,0.10)",
            boxShadow: "0 4px 32px rgba(0,0,0,0.40)",
          }}
        >
          {/* Notion card header */}
          <div
            style={{
              background: "#F7F7F5",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              padding: "8px 12px",
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <NotionMark size={14} />
            <span
              style={{
                fontFamily: tokens.sans,
                fontSize: 11,
                fontWeight: 500,
                color: "#37352F",
              }}
            >
              FIL 411 — Apuntes
            </span>
          </div>

          {/* Notion card body — mini page preview */}
          <div style={{ padding: "14px 16px" }}>
            {/* Title */}
            <div
              style={{
                fontFamily: tokens.serif,
                fontWeight: 700,
                fontSize: 14,
                color: "#191919",
                letterSpacing: "-0.02em",
                marginBottom: 10,
              }}
            >
              FIL 411 — Apuntes
            </div>

            {/* Skeleton lines representing content */}
            {[
              { w: "88%", opacity: 0.4 },
              { w: "72%", opacity: 0.3 },
              { w: "95%", opacity: 0.35 },
              { w: "60%", opacity: 0.25 },
              { w: "80%", opacity: 0.3 },
              { w: "55%", opacity: 0.2 },
            ].map(({ w, opacity: op }, i) => (
              <div
                key={i}
                style={{
                  height: 7,
                  background: "#37352F",
                  opacity: op,
                  borderRadius: 3,
                  marginBottom: 5,
                  width: w,
                }}
              />
            ))}

            {/* Page count */}
            <div
              style={{
                marginTop: 12,
                fontFamily: tokens.mono,
                fontSize: 9.5,
                color: "#9B9B9B",
                letterSpacing: "0.04em",
              }}
            >
              312 páginas · última edición hace 2 h
            </div>
          </div>
        </div>

        {/* Center: connection line + status */}
        <div
          style={{
            flex: 1,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            paddingTop: 0,
          }}
        >
          {/* Connection line */}
          <div
            style={{
              position: "relative",
              width: "100%",
              height: 1,
              background: tokens.recessed,
            }}
          >
            {/* Animated fill */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                width: `${lineProgress * 100}%`,
                background: `linear-gradient(to right, ${tokens.accent}60, ${tokens.accentSoft})`,
              }}
            />
            {/* Arrowhead */}
            {lineProgress > 0.9 && (
              <div
                style={{
                  position: "absolute",
                  right: -4,
                  top: -3.5,
                  width: 8,
                  height: 8,
                  borderTop: `1.5px solid ${tokens.accentSoft}`,
                  borderRight: `1.5px solid ${tokens.accentSoft}`,
                  transform: "rotate(45deg)",
                  opacity: (lineProgress - 0.9) * 10,
                }}
              />
            )}
            {/* Traveling pulses */}
            {dotsVisible && <PulseDot frame={frame} offset={0} />}
            {dotsVisible && <PulseDot frame={frame} offset={20} />}
          </div>

          {/* Status pill */}
          <div
            style={{
              opacity: pillOpacity,
              transform: `scale(${pillScale})`,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: tokens.base,
              border: `1px solid ${tokens.greenTint}`,
              borderRadius: 20,
              padding: "4px 12px",
            }}
          >
            {/* Rotating sync icon */}
            <div
              style={{
                width: 12,
                height: 12,
                transform: `rotate(${syncRotation}deg)`,
                flexShrink: 0,
              }}
            >
              <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6 1.5A4.5 4.5 0 0 1 10.5 6"
                  stroke={tokens.greenFg}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M6 10.5A4.5 4.5 0 0 1 1.5 6"
                  stroke={tokens.greenFg}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path d="M9.5 3.5 L10.5 6 L8 5.5" stroke={tokens.greenFg} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                letterSpacing: "0.12em",
                color: tokens.greenFg,
                textTransform: "uppercase",
              }}
            >
              conectado
            </span>
          </div>
        </div>

        {/* Right: NoeticAI card */}
        <div
          style={{
            opacity: noeticOpacity,
            transform: `translateX(${noeticTranslateX}px)`,
            flex: "0 0 240px",
            background: tokens.base,
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${tokens.lineStrong}`,
          }}
        >
          {/* NoeticAI card header */}
          <div
            style={{
              background: tokens.recessed,
              borderBottom: `1px solid ${tokens.lineStrong}`,
              padding: "8px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* Accent dot */}
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: tokens.accent,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: tokens.serif,
                fontStyle: "italic",
                fontSize: 13,
                color: tokens.fg,
                letterSpacing: "-0.01em",
              }}
            >
              <span style={{ color: tokens.accent }}>N</span>oeticAI
            </span>
          </div>

          {/* NoeticAI card body */}
          <div style={{ padding: "14px 16px" }}>
            <div
              style={{
                fontFamily: tokens.mono,
                fontSize: 9,
                letterSpacing: "0.16em",
                color: tokens.fgFaint,
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              integración activa
            </div>

            {/* Integration details */}
            {[
              { label: "workspace", value: "Universidad" },
              { label: "fuente", value: "FIL 411" },
              { label: "estado", value: "● sincronizado", green: true },
            ].map(({ label, value, green }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 7,
                }}
              >
                <span
                  style={{
                    fontFamily: tokens.mono,
                    fontSize: 9.5,
                    color: tokens.fgFaint,
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontFamily: tokens.mono,
                    fontSize: 9.5,
                    color: green ? tokens.greenFg : tokens.fgMuted,
                    letterSpacing: "0.04em",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}

            {/* Permission grant row */}
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px solid ${tokens.line}`,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: tokens.greenTint,
                  border: `1px solid ${tokens.greenFg}40`,
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
                    transform: "rotate(-45deg) translateY(-1px)",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  color: tokens.fgMuted,
                  letterSpacing: "0.04em",
                }}
              >
                acceso autorizado
              </span>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
