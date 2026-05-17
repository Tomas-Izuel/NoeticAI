import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { tokens } from "./lib/tokens";
import { IngestScene } from "./scenes/IngestScene";
import { AuditScene } from "./scenes/AuditScene";
import { CloseScene } from "./scenes/CloseScene";

// Scene timing (frames at 30fps)
// 0–120: Ingest (4s)
// 120–270: Audit (5s)
// 270–390: Close (4s)

const INGEST_START = 0;
const INGEST_DURATION = 120;
const AUDIT_START = 120;
const AUDIT_DURATION = 150;
const CLOSE_START = 270;
const CLOSE_DURATION = 120;
const TOTAL_FRAMES = 390;

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

type SceneKey = "ingest" | "audit" | "close";

interface StepInfo {
  key: SceneKey;
  num: string;
  label: string;
  start: number;
  end: number;
}

const STEPS: StepInfo[] = [
  { key: "ingest", num: "01", label: "INGESTAR", start: INGEST_START, end: AUDIT_START },
  { key: "audit", num: "02", label: "AUDITAR", start: AUDIT_START, end: CLOSE_START },
  { key: "close", num: "03", label: "CERRAR", start: CLOSE_START, end: TOTAL_FRAMES },
];

function getCurrentStep(frame: number): SceneKey {
  if (frame < AUDIT_START) return "ingest";
  if (frame < CLOSE_START) return "audit";
  return "close";
}

/** Persistent top strip — crossfades step name between scenes */
function TopStrip() {
  const frame = useCurrentFrame();
  const currentKey = getCurrentStep(frame);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        background: tokens.recessed,
        borderBottom: `1px solid ${tokens.lineStrong}`,
        display: "flex",
        alignItems: "center",
        padding: "0 32px",
        gap: 24,
        zIndex: 10,
      }}
    >
      {/* Brand mark */}
      <span
        style={{
          fontFamily: tokens.serif,
          fontStyle: "italic",
          fontSize: 14,
          color: tokens.fg,
          letterSpacing: "-0.01em",
          flexShrink: 0,
        }}
      >
        <span style={{ color: tokens.accent }}>N</span>oeticAI
      </span>

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: 14,
          background: tokens.lineStrong,
          flexShrink: 0,
        }}
      />

      {/* Step indicators */}
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        {STEPS.map((step) => {
          const isActive = step.key === currentKey;

          // Cross-fade: compute per-step opacity
          // Active step: fades in at transition +8 frames, fades out at transition -8 frames
          const FADE = 10;
          const inOpacity = interpolate(
            frame,
            [step.start, step.start + FADE],
            [0, 1],
            { ...clamp(), easing: ease }
          );
          const outOpacity =
            step.end < TOTAL_FRAMES
              ? interpolate(frame, [step.end - FADE, step.end + FADE], [1, 0], {
                  ...clamp(),
                  easing: ease,
                })
              : 1;
          const opacity = Math.min(inOpacity, outOpacity);

          return (
            <div
              key={step.key}
              style={{
                opacity: isActive ? opacity : Math.max(0, 1 - opacity) * 0.25,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 8.5,
                  letterSpacing: "0.12em",
                  color: tokens.fgFaint,
                }}
              >
                /
              </span>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 8.5,
                  letterSpacing: "0.12em",
                  color: isActive ? tokens.fgMuted : tokens.fgFaint,
                }}
              >
                {step.num}
              </span>
              <span
                style={{
                  fontFamily: tokens.mono,
                  fontSize: 9,
                  letterSpacing: "0.22em",
                  color: isActive ? tokens.fg : tokens.fgFaint,
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right: frame/time display */}
      <div style={{ marginLeft: "auto" }}>
        <span
          style={{
            fontFamily: tokens.mono,
            fontSize: 8.5,
            letterSpacing: "0.1em",
            color: tokens.fgFaint,
          }}
        >
          {String(Math.floor(frame / 30)).padStart(2, "0")}:
          {String(Math.round(((frame / 30) % 1) * 100)).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

/** Scene transition overlay — brief flash between scenes */
function TransitionFlash({ from }: { from: number }) {
  const frame = useCurrentFrame();
  const FLASH_DURATION = 10;
  const localFrame = frame - from;
  const opacity = interpolate(
    localFrame,
    [0, FLASH_DURATION / 2, FLASH_DURATION],
    [0, 0.15, 0],
    { ...clamp(), easing: Easing.linear }
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: tokens.fg,
        opacity,
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}

/** Bottom hairline decoration */
function BottomBar() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 24,
        background: tokens.recessed,
        borderTop: `1px solid ${tokens.lineStrong}`,
        display: "flex",
        alignItems: "center",
        padding: "0 32px",
        zIndex: 10,
      }}
    >
      <span
        style={{
          fontFamily: tokens.mono,
          fontSize: 7.5,
          letterSpacing: "0.16em",
          color: tokens.fgFaint,
          textTransform: "uppercase",
        }}
      >
        revisión sistemática · epistemología · FIL 411
      </span>
    </div>
  );
}

export function FlowAnimation() {
  return (
    <AbsoluteFill style={{ background: tokens.canvas }}>
      {/* Persistent chrome */}
      <TopStrip />
      <BottomBar />

      {/* Scene container — offset by top strip height */}
      <div
        style={{
          position: "absolute",
          top: 36,
          bottom: 24,
          left: 0,
          right: 0,
          overflow: "hidden",
        }}
      >
        {/* Background hairlines */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `repeating-linear-gradient(
              0deg,
              transparent,
              transparent 47px,
              rgba(255,255,255,0.012) 47px,
              rgba(255,255,255,0.012) 48px
            )`,
            pointerEvents: "none",
          }}
        />

        {/* Ingest scene */}
        <Sequence from={INGEST_START} durationInFrames={AUDIT_START + 16}>
          <IngestScene />
        </Sequence>

        {/* Audit scene */}
        <Sequence from={AUDIT_START} durationInFrames={CLOSE_START + 16 - AUDIT_START}>
          <AuditScene />
        </Sequence>

        {/* Close scene */}
        <Sequence from={CLOSE_START} durationInFrames={CLOSE_DURATION + 16}>
          <CloseScene />
        </Sequence>

        {/* Transition flashes */}
        <TransitionFlash from={AUDIT_START - 5} />
        <TransitionFlash from={CLOSE_START - 5} />
      </div>
    </AbsoluteFill>
  );
}
