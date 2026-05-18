interface PricingProps {
  onWaitlist: () => void;
}

export function Pricing({ onWaitlist }: PricingProps) {
  return (
    <section className="section" id="pricing" aria-labelledby="pricing-title">
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">Precios</div>
          <h2 id="pricing-title">
            Pensado para{" "}
            <span className="em">
              quienes compran sus propios&nbsp;libros
            </span>
            .
          </h2>
          <p className="section-lede">
            Gratis para un curso. Un plan académico para quienes trabajan en
            serio. Y un plan futuro — autónomo — donde NoeticAI trabajará por su
            cuenta entre tus sesiones.
          </p>
        </header>

        <div className="pricing">
          {/* Free tier */}
          <div className="price">
            <div className="price-name">Estudiante</div>
            <div className="price-num">
              0&nbsp;US$<span className="per">/ siempre</span>
            </div>
            <div className="price-tag">
              Un curso. Revisión completa. Sin ceremonia.
            </div>
            <ul>
              <li>Un curso o lista de lecturas activa</li>
              <li>Sincronización con Notion, análisis del programa</li>
              <li>Columna de cobertura y constelación</li>
              <li>Hasta 100 conceptos auditados</li>
            </ul>
            <button className="btn btn-outline" type="button" onClick={onWaitlist}>Empezar →</button>
          </div>

          {/* Scholar tier */}
          <div className="price highlight">
            <div className="price-name">Académico</div>
            <div className="price-num">
              5&nbsp;US$<span className="per">/ mes</span>
            </div>
            <div className="price-tag">
              Un semestre entero de revisiones, en paralelo.
            </div>
            <ul>
              <li>Cursos y listas de lecturas ilimitados</li>
              <li>Sugerencias citadas a demanda</li>
              <li>Detección de conflictos entre notas</li>
              <li>Puntuación de confianza bibliográfica</li>
              <li>Exportación a PDF y BibTeX</li>
            </ul>
            <button className="btn btn-primary" type="button" onClick={onWaitlist}>Elegir Académico →</button>
          </div>

          {/* Autonomous tier — coming soon */}
          <div className="price soon">
            <div className="price-name">
              Autónomo <span className="soon-tag">Próximamente</span>
            </div>
            <div className="price-num soon-num">
              <span className="tbd">— —</span>
              <span className="per">/ precio por anunciar</span>
            </div>
            <div className="price-tag">
              NoeticAI que trabaja entre tus sesiones, no solo durante ellas.
            </div>
            <ul>
              <li>Agentes especializados por disciplina</li>
              <li>Tareas programadas que reauditan tu corpus</li>
              <li>Enriquecimiento continuo de la bibliografía</li>
              <li>Detección proactiva de nuevos vacíos</li>
              <li>Lecturas sugeridas extraídas mientras duermes</li>
            </ul>
            <button
              className="btn btn-outline"
              onClick={onWaitlist}
              type="button"
            >
              Apuntarme a la lista →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
