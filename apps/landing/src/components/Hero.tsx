interface HeroProps {
  onWaitlist: () => void;
}

export function Hero({ onWaitlist }: HeroProps) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container">
        <div className="hero-grid">
          <div>
            <div className="hero-eyebrow">
              <span className="dot" aria-hidden="true" />
              Una auditoría del conocimiento para aprendices serios
            </div>
            <h1 id="hero-title">
              Encuentra los <span className="em">vacíos</span> en lo que crees
              que&nbsp;sabes.
            </h1>
            <p className="hero-lede">
              NoeticAI lee las notas que mantienes en{" "}
              <strong>Notion</strong>, las compara con tu programa de estudios y
              bibliografía, y produce un mapa de cobertura de tu comprensión —{" "}
              <strong>cubierto</strong>, <strong>incompleto</strong> y{" "}
              <strong>ausente</strong> — concepto por concepto.
            </p>
            <div className="hero-cta">
              <button
                className="btn btn-primary btn-lg"
                onClick={onWaitlist}
                type="button"
              >
                Unirme a la lista de espera
              </button>
              <a className="btn btn-outline btn-lg" href="#how">
                Ver cómo funciona
              </a>
            </div>
            <div className="hero-meta" role="list">
              <span className="item" role="listitem">
                <span className="dot" aria-hidden="true" />
                Gratis para un curso
              </span>
              <span className="item" role="listitem">
                <span className="dot" aria-hidden="true" />
                Notion · Obsidian (beta)
              </span>
              <span className="item" role="listitem">
                <span className="dot" aria-hidden="true" />
                SOC&nbsp;2 en&nbsp;curso
              </span>
            </div>
          </div>

          <figure
            className="hero-visual"
            role="img"
            aria-label="Una auditoría de cobertura de un curso de epistemología que muestra 41 conceptos cubiertos, 22 incompletos y 18 ausentes."
          >
            <div className="hv-head">
              <div>
                <div className="hv-tag">Auditoría · Primavera 2026</div>
                <div className="hv-title">
                  Epistemología — una auditoría de cobertura
                </div>
              </div>
              <div className="hv-tag" style={{ color: "var(--green-fg)" }}>
                en vivo
              </div>
            </div>

            <div className="hv-spine" aria-hidden="true">
              <div className="seg-g" style={{ width: "48.8%" }} />
              <div className="seg-a" style={{ width: "26.2%" }} />
              <div className="seg-r" style={{ width: "21.4%" }} />
            </div>

            <div className="hv-stats">
              <div className="cell">
                <div className="num">41</div>
                <div className="lbl">
                  <span className="cov-dot green" aria-hidden="true" />
                  Cubierto
                </div>
              </div>
              <div className="cell">
                <div className="num">22</div>
                <div className="lbl">
                  <span className="cov-dot amber" aria-hidden="true" />
                  Incompleto
                </div>
              </div>
              <div className="cell">
                <div className="num">18</div>
                <div className="lbl">
                  <span className="cov-dot red" aria-hidden="true" />
                  Ausente
                </div>
              </div>
            </div>

            <div className="hv-list">
              <div className="hv-row">
                <span className="cov-dot green" aria-hidden="true" />
                <span className="name">El análisis tripartito (CVJ)</span>
                <span className="verdict green">cubierto</span>
              </div>
              <div className="hv-row">
                <span className="cov-dot amber" aria-hidden="true" />
                <span className="name">Fiabilismo</span>
                <span className="verdict amber">conflicto</span>
              </div>
              <div className="hv-row red">
                <span className="cov-dot red" aria-hidden="true" />
                <span className="name">Coherentismo</span>
                <span className="verdict red">ausente</span>
              </div>
              <div className="hv-row red">
                <span className="cov-dot red" aria-hidden="true" />
                <span className="name">Injusticia hermenéutica</span>
                <span className="verdict red">ausente</span>
              </div>
              <div className="hv-row">
                <span className="cov-dot amber" aria-hidden="true" />
                <span className="name">Contextualismo (DeRose, Lewis)</span>
                <span className="verdict amber">incompleto</span>
              </div>
            </div>

            <figcaption className="hv-margin">
              La frontera que puedes ver no es el límite de lo que sabes &mdash;
              sólo de lo que has escrito.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
