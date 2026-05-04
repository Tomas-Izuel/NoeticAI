export function Features() {
  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">Lo que hay dentro</div>
          <h2 id="features-title">
            Construido como un{" "}
            <span className="em">instrumento de investigación</span>, no como
            una app de estudio.
          </h2>
          <p className="section-lede">
            Cada superficie de NoeticAI está diseñada para el lector minucioso:
            académicos, estudiantes de posgrado, abogados, teólogos — cualquiera
            cuyo trabajo dependa de la integridad de un corpus escrito.
          </p>
        </header>
      </div>

      <div className="features">
        <article className="feat">
          <div className="feat-num">/ 01</div>
          <h3>La columna de cobertura</h3>
          <p>
            Un libro vertical con cada concepto que contiene tu programa, con
            profundidad, número de fuentes y veredicto a simple vista. Léelo
            como un índice; actúa sobre las filas rojas.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">conceptos:</span>{" "}
              <span className="v">84</span>
            </div>
            <div>
              <span className="k">cubiertos:</span>{" "}
              <span className="v">41</span>{" "}
              <span className="c">/ 48,8 %</span>
            </div>
            <div>
              <span className="k">incompletos:</span>{" "}
              <span className="v">22</span>{" "}
              <span className="c">/ 26,2 %</span>
            </div>
            <div>
              <span className="k">ausentes:</span>{" "}
              <span className="v">18</span>{" "}
              <span className="c">/ 21,4 %</span>
            </div>
          </div>
        </article>

        <article className="feat">
          <div className="feat-num">/ 02</div>
          <h3>Detección de conflictos</h3>
          <p>
            NoeticAI lee de lado tanto como hacia adelante. Cuando dos notas se
            contradicen — una cita mal atribuida, una definición que se desplazó
            entre semanas — saca la costura a la luz y muestra ambas versiones.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">conflicto:</span>{" "}
              <span className="v">Fiabilismo</span>
            </div>
            <div>
              <span className="c">
                › fiabilismo de procesos vs. de agentes
              </span>
            </div>
            <div>
              <span className="c">› confundidos en notas de la sem. 5</span>
            </div>
            <div>
              <span className="c">› reconciliar vía Goldman 1979 §3</span>
            </div>
          </div>
        </article>

        <article className="feat">
          <div className="feat-num">/ 03</div>
          <h3>Sugerencias citadas</h3>
          <p>
            Cada párrafo redactado lleva los números de página de sus fuentes.
            Nada se inventa. Si una afirmación no puede fundamentarse en tu
            bibliografía, NoeticAI se niega a escribirla.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">borrador:</span>{" "}
              <span className="v">Coherentismo (¶1)</span>
            </div>
            <div>
              <span className="c">› BonJour 1985, pp. 87–110</span>
            </div>
            <div>
              <span className="c">› Olsson 2017, §§2–4</span>
            </div>
            <div>
              <span className="c">› confianza: 0,94</span>
            </div>
          </div>
        </article>

        <article className="feat">
          <div className="feat-num">/ 04</div>
          <h3>La vista de constelación</h3>
          <p>
            Cambia de columna a grafo. Mira tus conceptos como nodos con aristas
            trazadas a partir de la coocurrencia en tus lecturas y notas. La
            forma de tu comprensión, hecha visible.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">vista:</span>{" "}
              <span className="v">constelación</span>
            </div>
            <div>
              <span className="c">› 84 nodos · 217 aristas</span>
            </div>
            <div>
              <span className="c">› 3 subgrafos aislados</span>
            </div>
            <div>
              <span className="c">› ⌘+K para enfocar un nodo</span>
            </div>
          </div>
        </article>

        <article className="feat">
          <div className="feat-num">/ 05</div>
          <h3>Confianza bibliográfica</h3>
          <p>
            Cada fuente que citas es puntuada por cuán a fondo aparece en tus
            notas. Las fuentes que apenas has abierto quedan marcadas. Las que
            has trabajado en profundidad pesan en consecuencia.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">fuentes:</span>{" "}
              <span className="v">14</span>
            </div>
            <div>
              <span className="c">› 9 trabajadas a fondo</span>
            </div>
            <div>
              <span className="c">› 3 citadas pero no leídas</span>
            </div>
            <div>
              <span className="c">› 2 ausentes del corpus</span>
            </div>
          </div>
        </article>

        <article className="feat">
          <div className="feat-num">/ 06</div>
          <h3>Sincronización silenciosa</h3>
          <p>
            NoeticAI reejecuta tu auditoría en segundo plano a medida que tus
            notas cambian. Los veredictos se actualizan sin ceremonia. Nunca
            tienes que preguntarte si el mapa está al día.
          </p>
          <div className="feat-detail">
            <div>
              <span className="k">última sinc:</span>{" "}
              <span className="v">hace 2 min</span>
            </div>
            <div>
              <span className="c">› +412 palabras sobre Gettier</span>
            </div>
            <div>
              <span className="c">› 12 conceptos reevaluados</span>
            </div>
            <div>
              <span className="c">
                › 1 veredicto cambió: ámbar → verde
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
