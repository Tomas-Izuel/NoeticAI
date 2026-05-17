import { Player } from "@remotion/player";
import { FlowAnimation } from "../animations/FlowAnimation/FlowAnimation";

export function FlowAnimationSection() {
  return (
    <section
      className="section flow-animation-section"
      aria-labelledby="flow-animation-title"
    >
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">En movimiento</div>
          <h2 id="flow-animation-title">
            Tres movimientos,{" "}
            <span className="em">vistos a la vez</span>.
          </h2>
          <p className="section-lede">
            Ingestar, auditar, cerrar — un ciclo vivo que transforma tus
            apuntes en un mapa de cobertura completo ante tus ojos.
          </p>
        </header>

        <div className="flow-player-wrap">
          <Player
            component={FlowAnimation}
            durationInFrames={390}
            fps={30}
            compositionWidth={1280}
            compositionHeight={720}
            autoPlay
            loop
            controls={false}
            style={{
              width: "100%",
              aspectRatio: "1280 / 720",
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid var(--line-strong)",
            }}
          />
        </div>
      </div>
    </section>
  );
}
