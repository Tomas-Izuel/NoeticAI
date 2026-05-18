import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { tokens } from "./lib/tokens";
import { NotionNotesScene } from "./scenes/NotionNotesScene";
import { ConnectScene } from "./scenes/ConnectScene";
import { LoadingScene } from "./scenes/LoadingScene";
import { GapsScene } from "./scenes/GapsScene";
import { CompletionScene } from "./scenes/CompletionScene";

// Scene timing (frames at 30fps)
// 0–120:   Notas    (4s)
// 120–240: Conectar (4s)
// 240–360: Cargar   (4s)
// 360–510: Vacíos   (5s)
// 510–630: Completar (4s)

const NOTAS_START = 0;
const NOTAS_DURATION = 120;

const CONECTAR_START = 120;
const CONECTAR_DURATION = 120;

const CARGAR_START = 240;
const CARGAR_DURATION = 120;

const VACIOS_START = 360;
const VACIOS_DURATION = 150;

const COMPLETAR_START = 510;
const COMPLETAR_DURATION = 120;

export const TOTAL_FRAMES = 630;

const ease = Easing.bezier(0.16, 1, 0.3, 1);

function clamp(): { extrapolateLeft: "clamp"; extrapolateRight: "clamp" } {
  return { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
}

type SceneKey = "notas" | "conectar" | "cargar" | "vacios" | "completar";

interface StepInfo {
  key: SceneKey;
  num: string;
  label: string;
  start: number;
  end: number;
}

const STEPS: StepInfo[] = [
  { key: "notas",     num: "01", label: "NOTAS",     start: NOTAS_START,     end: CONECTAR_START },
  { key: "conectar",  num: "02", label: "CONECTAR",  start: CONECTAR_START,  end: CARGAR_START },
  { key: "cargar",    num: "03", label: "CARGAR",    start: CARGAR_START,    end: VACIOS_START },
  { key: "vacios",    num: "04", label: "VACÍOS",    start: VACIOS_START,    end: COMPLETAR_START },
  { key: "completar", num: "05", label: "COMPLETAR", start: COMPLETAR_START, end: TOTAL_FRAMES },
];

function getCurrentStep(frame: number): SceneKey {
  if (frame < CONECTAR_START)  return "notas";
  if (frame < CARGAR_START)    return "conectar";
  if (frame < VACIOS_START)    return "cargar";
  if (frame < COMPLETAR_START) return "vacios";
  return "completar";
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
        apuntes · programa · vacíos · completitud · FIL 411
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

        {/* Scene 1: Notion Notes */}
        <Sequence from={NOTAS_START} durationInFrames={CONECTAR_START + 16}>
          <NotionNotesScene />
        </Sequence>

        {/* Scene 2: Connect */}
        <Sequence from={CONECTAR_START} durationInFrames={CARGAR_START + 16 - CONECTAR_START}>
          <ConnectScene />
        </Sequence>

        {/* Scene 3: Loading / Ingest */}
        <Sequence from={CARGAR_START} durationInFrames={VACIOS_START + 16 - CARGAR_START}>
          <LoadingScene />
        </Sequence>

        {/* Scene 4: Gaps / Audit */}
        <Sequence from={VACIOS_START} durationInFrames={COMPLETAR_START + 16 - VACIOS_START}>
          <GapsScene />
        </Sequence>

        {/* Scene 5: Completion */}
        <Sequence from={COMPLETAR_START} durationInFrames={COMPLETAR_DURATION + 16}>
          <CompletionScene />
        </Sequence>

        {/* Transition flashes at scene boundaries */}
        <TransitionFlash from={CONECTAR_START - 5} />
        <TransitionFlash from={CARGAR_START - 5} />
        <TransitionFlash from={VACIOS_START - 5} />
        <TransitionFlash from={COMPLETAR_START - 5} />
      </div>
    </AbsoluteFill>
  );
}
