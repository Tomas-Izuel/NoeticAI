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
            <div className="price-name">Prueba gratuita</div>
            <div className="price-num">
              0&nbsp;US$<span className="per">/ siempre</span>
            </div>
            <div className="price-tag">
              Un curso. Auditoría completa. Sin ceremonia.
            </div>
            <ul>
              <li>Un curso o lista de lecturas activa</li>
              <li>Sincronización con Notion, análisis del programa</li>
              <li>Columna de cobertura y constelación</li>
            </ul>
            <button className="btn btn-outline" onClick={onWaitlist} type="button">
              Unirse a la lista de espera
            </button>
          </div>

          {/* Scholar tier */}
          <div className="price highlight">
            <div className="price-name">Académico</div>
            <div className="price-num">
              12&nbsp;US$<span className="per">/ mes</span>
            </div>
            <div className="price-tag">
              Un semestre entero de auditorías, en paralelo.
            </div>
            <ul>
              <li>Hasta 10 cursos o listas de lecturas</li>
              <li>Sugerencias citadas a demanda</li>
              <li>Detección de conflictos entre notas</li>
              <li>Puntuación de confianza bibliográfica</li>
              <li>Completado de notas en base a fuentes</li>
            </ul>
            <button className="btn btn-primary" onClick={onWaitlist} type="button">
              Unirse a la lista de espera
            </button>
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
            <button className="btn btn-outline" onClick={onWaitlist} type="button">
              Apuntarme a la lista
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
