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
            <pre className="feat-art" aria-hidden="true">{
              /* Art: horizontal stacked bars, three-state */
              ""
            }<span className="green">{"cubierto   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓   41\n"}</span
            ><span className="amber">{"incompleto ▒▒▒▒▒▒▒▒         22\n"}</span
            ><span className="red">{"ausente    ░░░░░░           18\n"}</span
            ><span className="c">{"                    — 84 conceptos"}</span></pre>
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
            <pre className="feat-art" aria-hidden="true"
            ><span className="c">{"sem. 3  "}</span
            ><span>{"fiabilismo de procesos\n"}</span
            ><span className="c">{"        │\n"}</span
            ><span className="c">{"sem. 5  "}</span
            ><span>{"fiabilismo de agentes\n"}</span
            ><span className="c">{"        │\n"}</span
            ><span className="amber">{"        ◇ conflicto\n"}</span
            ><span className="c">{"        │\n"}</span
            ><span className="c">{"        └─ Goldman 1979 §3"}</span></pre>
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
            <pre className="feat-art" aria-hidden="true"
            ><span className="c">{"╭──────────────────────────────────────╮\n"}</span
            ><span>{"│ El coherentismo sostiene que una     │\n"}</span
            ><span>{"│ creencia está justificada si forma   │\n"}</span
            ><span>{"│ parte de un sistema coherente.       │\n"}</span
            ><span className="c">{"╰──────────────────────────────────────╯\n"}</span
            ><span className="k">{"  └─ BonJour 1985, p.87\n"}</span
            ><span className="c">{"     confianza: 0.94"}</span></pre>
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
            <pre className="feat-art" aria-hidden="true"
            ><span>{"  CVJ ──── Gettier ──── Contexto\n"}</span
            ><span className="c">{"   │                       │\n"}</span
            ><span>{"   ├── Fiabilismo       Extern.\n"}</span
            ><span className="c">{"   │       │\n"}</span
            ><span className="c">{"   │   Goldman 1979\n"}</span
            ><span className="c">{"   │\n"}</span
            ><span>{"   └── Coherentismo\n"}</span
            ><span>{"\n"}</span
            ><span className="c">{"                       ○ aislado"}</span></pre>
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
            <pre className="feat-art" aria-hidden="true"
            ><span className="green">{"BonJour 1985   ████████████  trabajada\n"}</span
            ><span className="amber">{"Goldman 1979   ████████░░░░  parcial\n"}</span
            ><span className="amber">{"Olsson 2017    ████░░░░░░░░  parcial\n"}</span
            ><span className="red">{"Zagzebski      ░░░░░░░░░░░░  no leída\n"}</span
            ><span className="red">{"Williams 2001  ░░░░░░░░░░░░  no leída"}</span></pre>
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
            <pre className="feat-art" aria-hidden="true"
            ><span className="c">{"─── hace 4 min ─────────────────────\n"}</span
            ><span>{"  Gettier    "}</span
            ><span className="amber">{"ámbar"}</span
            ><span>{" → "}</span
            ><span className="green">{"verde\n"}</span
            ><span className="c">{"─── hace 2 min ─────────────────────\n"}</span
            ><span>{"  +412 palabras · 12 reevaluados\n"}</span
            ><span className="c">{"─── ahora ───────────────────────────\n"}</span
            ><span className="c">{"  sincronizando..."}</span></pre>
          </div>
        </article>
      </div>
    </section>
  );
}
