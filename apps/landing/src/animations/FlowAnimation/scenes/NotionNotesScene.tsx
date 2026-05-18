import { useCurrentFrame, interpolate, Easing, AbsoluteFill } from "remotion";
import { tokens } from "../lib/tokens";

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

// Notion "N" mark — inline SVG rounded square
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

interface NotionLineProps {
  frame: number;
  delay: number;
  content: string;
  isHeading?: boolean;
  isBullet?: boolean;
  isSubBullet?: boolean;
  isCite?: boolean;
}

function NotionLine({
  frame,
  delay,
  content,
  isHeading = false,
  isBullet = false,
  isSubBullet = false,
  isCite = false,
}: NotionLineProps) {
  const progress = interpolate(frame, [delay, delay + 18], [0, 1], {
    ...clamp(),
    easing: ease,
  });

  // Typewriter-style reveal: show progressively more characters
  const charCount = Math.round(progress * content.length);
  const visibleText = content.substring(0, charCount);
  const isTyping = charCount < content.length;

  const fontSizeMap = {
    heading: 15,
    bullet: 12.5,
    subBullet: 11.5,
    cite: 11,
    body: 12.5,
  };

  const fontSize = isHeading
    ? fontSizeMap.heading
    : isSubBullet
      ? fontSizeMap.subBullet
      : isCite
        ? fontSizeMap.cite
        : fontSizeMap.bullet;

  return (
    <div
      style={{
        opacity: progress > 0 ? 1 : 0,
        display: "flex",
        alignItems: "baseline",
        gap: isBullet || isSubBullet ? 6 : 0,
        marginBottom: isHeading ? 8 : 4,
        paddingLeft: isSubBullet ? 20 : isBullet ? 0 : 0,
        minHeight: fontSize * 1.6,
      }}
    >
      {isBullet && (
        <span
          style={{
            fontFamily: tokens.sans,
            fontSize: 10,
            color: "#6B6B6B",
            flexShrink: 0,
            lineHeight: `${fontSize * 1.6}px`,
          }}
        >
          •
        </span>
      )}
      {isSubBullet && (
        <span
          style={{
            fontFamily: tokens.sans,
            fontSize: 9,
            color: "#9B9B9B",
            flexShrink: 0,
            lineHeight: `${fontSize * 1.6}px`,
          }}
        >
          ◦
        </span>
      )}
      <span
        style={{
          fontFamily: isHeading ? tokens.serif : isCite ? tokens.mono : tokens.sans,
          fontWeight: isHeading ? 600 : 400,
          fontSize,
          color: isHeading ? "#191919" : isCite ? "#6B6B6B" : "#37352F",
          lineHeight: 1.6,
          fontStyle: isCite ? "italic" : "normal",
          letterSpacing: isHeading ? "-0.02em" : "0em",
        }}
      >
        {visibleText}
        {isTyping && progress > 0.05 && (
          <span
            style={{
              display: "inline-block",
              width: 1,
              height: "0.85em",
              background: "#37352F",
              marginLeft: 1,
              verticalAlign: "text-bottom",
              opacity: frame % 18 < 9 ? 0.7 : 0,
            }}
          />
        )}
      </span>
    </div>
  );
}

export function NotionNotesScene() {
  const frame = useCurrentFrame();

  // Document card slide-up entrance
  const docOpacity = interpolate(frame, [0, 22], [0, 1], { ...clamp(), easing: ease });
  const docTranslateY = interpolate(frame, [0, 22], [20, 0], { ...clamp(), easing: ease });

  // Sidebar opacity
  const sidebarOpacity = interpolate(frame, [4, 18], [0, 1], { ...clamp(), easing: ease });

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
      {/* Notion window chrome */}
      <div
        style={{
          opacity: docOpacity,
          transform: `translateY(${docTranslateY}px)`,
          width: "100%",
          maxWidth: 820,
          background: "#FFFFFF",
          borderRadius: 10,
          overflow: "hidden",
          border: `1px solid rgba(0,0,0,0.08)`,
          boxShadow: "0 4px 40px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Window titlebar */}
        <div
          style={{
            background: "#F7F7F5",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            padding: "0 16px",
            height: 30,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          {/* Traffic lights */}
          {["#FF5F57", "#FEBC2E", "#28C840"].map((color) => (
            <div
              key={color}
              style={{ width: 10, height: 10, borderRadius: "50%", background: color }}
            />
          ))}
          <div style={{ flex: 1 }} />
          {/* Tab label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "#EFEFEF",
              borderRadius: 4,
              padding: "2px 8px",
            }}
          >
            <NotionMark size={12} />
            <span
              style={{
                fontFamily: tokens.sans,
                fontSize: 10,
                color: "#37352F",
                letterSpacing: "0em",
              }}
            >
              FIL 411 — Apuntes de clase
            </span>
          </div>
          <div style={{ flex: 1 }} />
        </div>

        {/* Content area: sidebar + page */}
        <div style={{ display: "flex", height: 380 }}>
          {/* Notion sidebar */}
          <div
            style={{
              opacity: sidebarOpacity,
              width: 180,
              background: "#F7F7F5",
              borderRight: "1px solid rgba(0,0,0,0.06)",
              padding: "14px 8px",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {/* Workspace header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                marginBottom: 6,
              }}
            >
              <NotionMark size={14} />
              <span
                style={{
                  fontFamily: tokens.sans,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#37352F",
                }}
              >
                Universidad
              </span>
            </div>

            {/* Sidebar nav items */}
            {[
              { label: "FIL 411 — Epistemología", active: true, depth: 0 },
              { label: "Apuntes de clase", active: false, depth: 1 },
              { label: "Bibliografía", active: false, depth: 1 },
              { label: "FIL 220 — Lógica", active: false, depth: 0 },
              { label: "FIL 330 — Ética", active: false, depth: 0 },
            ].map(({ label, active, depth }) => (
              <div
                key={label}
                style={{
                  padding: `3px ${8 + depth * 12}px`,
                  borderRadius: 4,
                  background: active ? "rgba(0,0,0,0.05)" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    fontFamily: tokens.sans,
                    fontSize: 10.5,
                    color: active ? "#37352F" : "#9B9B9B",
                    fontWeight: active ? 500 : 400,
                    letterSpacing: "0em",
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Page content */}
          <div
            style={{
              flex: 1,
              background: "#FFFFFF",
              padding: "28px 36px 24px",
              overflowY: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Page title */}
            <div
              style={{
                opacity: interpolate(frame, [10, 28], [0, 1], { ...clamp(), easing: ease }),
                fontFamily: tokens.serif,
                fontWeight: 700,
                fontSize: 22,
                color: "#191919",
                letterSpacing: "-0.025em",
                lineHeight: 1.3,
                marginBottom: 20,
              }}
            >
              FIL 411 — Apuntes de clase
            </div>

            {/* Progressive lines */}
            <NotionLine
              frame={frame}
              delay={22}
              content="1. Introducción a la epistemología"
              isHeading
            />
            <NotionLine
              frame={frame}
              delay={32}
              content="La epistemología estudia la naturaleza, el alcance y los límites del conocimiento humano."
              isBullet
            />
            <NotionLine
              frame={frame}
              delay={46}
              content="¿Qué es el conocimiento? → análisis tripartito: creencia verdadera justificada"
              isBullet
            />
            <NotionLine
              frame={frame}
              delay={58}
              content="Gettier 1963 — casos que refutan el análisis clásico"
              isSubBullet
            />
            <NotionLine
              frame={frame}
              delay={68}
              content="2. Justificación epistémica"
              isHeading
            />
            <NotionLine
              frame={frame}
              delay={78}
              content="Fiabilismo: la justificación depende de procesos cognitivos confiables"
              isBullet
            />
            <NotionLine
              frame={frame}
              delay={90}
              content="[BonJour 1985, §4] — coherentismo como alternativa al fundacionalismo"
              isCite
            />
            <NotionLine
              frame={frame}
              delay={100}
              content="Virtud epistémica: Sosa 1991, capacidades estables del agente"
              isBullet
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
