export function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">Cómo funciona</div>
          <h2 id="how-title">
            Tres movimientos, repetidos{" "}
            <span className="em">hasta que el mapa esté&nbsp;completo</span>.
          </h2>
          <p className="section-lede">
            NoeticAI no es un cuaderno, ni un generador de tarjetas, ni un
            chatbot. Es una revisión sistemática. Apuntas a lo que tienes y a lo
            que la disciplina espera, y te dice la diferencia.
          </p>
        </header>

        <div className="steps">
          <article className="step">
            <div className="num">/ 01 — INGESTAR</div>
            <h3>Conecta tus notas y tu programa.</h3>
            <p>
              Autentica Notion, sube un PDF del programa y pega una lista de
              lecturas. NoeticAI analiza cada uno en un conjunto de conceptos
              con sus citas preservadas.
            </p>
            <div className="step-art">
              <span className="ln">
                <span className="c"># fuente</span>
              </span>
              <span className="ln">
                <span className="k">notion:</span>{" "}
                <span className="v">FIL 411 — Notas</span>
              </span>
              <span className="ln">
                <span className="k">programa:</span>{" "}
                <span className="v">fil411_v3.pdf</span>
              </span>
              <span className="ln">
                <span className="k">bibliografía:</span>{" "}
                <span className="v">14 fuentes</span>
              </span>
              <span className="ln">
                <span className="c">› 247 fragmentos · 84 conceptos</span>
              </span>
              <span className="ln">
                <span className="c">› análisis completado</span>
              </span>
            </div>
          </article>

          <article className="step">
            <div className="num">/ 02 — AUDITAR</div>
            <h3>Cada concepto es juzgado contra tu corpus.</h3>
            <p>
              Para cada concepto del programa, NoeticAI recupera lo que has
              escrito, sopesa profundidad y cobertura de fuentes, y emite un
              veredicto.
            </p>
            <div className="step-art spine-art">
              <div className="row">
                <span className="cov-dot green" aria-hidden="true" />
                <span>Escepticismo cartesiano</span>
                <span className="pill green">cubierto</span>
              </div>
              <div className="row muted">
                <span className="cov-dot red" aria-hidden="true" />
                <span>Coherentismo</span>
                <span className="pill red">ausente</span>
              </div>
              <div className="row">
                <span className="cov-dot amber" aria-hidden="true" />
                <span>Principio de cierre</span>
                <span
                  className="pill"
                  style={{
                    background: "var(--amber-tint)",
                    color: "var(--amber-fg)",
                  }}
                >
                  parcial
                </span>
              </div>
              <div className="row muted">
                <span className="cov-dot red" aria-hidden="true" />
                <span>Teoría del rastreo</span>
                <span className="pill red">ausente</span>
              </div>
            </div>
          </article>

          <article className="step">
            <div className="num">/ 03 — CERRAR</div>
            <h3>Texto sugerido — íntegramente citado — para cada vacío.</h3>
            <p>
              Para cada vacío rojo, NoeticAI redacta un párrafo basado en tu
              bibliografía. Lo lees, lo editas y lo aceptas de vuelta en tus
              notas. Nada se inventa; cada afirmación tiene fuente.
            </p>
            <div className="step-art suggest-art">
              El coherentismo rechaza la asimetría fundacionalista entre
              creencias básicas y no básicas. La justificación surge del apoyo
              mutuo entre creencias en un sistema holístico{" "}
              <span className="cite">[BonJour&nbsp;1985, §5]</span>.
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
