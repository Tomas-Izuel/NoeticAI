import { useAnimateOnVisible } from "../lib/useAnimateOnVisible";

export function Features() {
  const animateRef = useAnimateOnVisible<HTMLElement>(false);
  return (
    <section className="section" id="features" aria-labelledby="features-title" ref={animateRef}>
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
          <pre className="feat-ascii" aria-hidden="true">
            <span className="f">{"concepto                  fuentes  veredicto\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="d">{"Gettier, casos"}</span>
            {"            "}
            <span className="d">{"07"}</span>
            {"     "}
            <span className="g">{"■ cubierto\n"}</span>
            <span className="d">{"justificación"}</span>
            {"             "}
            <span className="d">{"05"}</span>
            {"     "}
            <span className="g">{"■ cubierto\n"}</span>
            <span className="d">{"fiabilismo"}</span>
            {"                "}
            <span className="d">{"02"}</span>
            {"     "}
            <span className="a">{"■ incompleto\n"}</span>
            <span className="d">{"coherentismo"}</span>
            {"              "}
            <span className="d">{"04"}</span>
            {"     "}
            <span className="g">{"■ cubierto\n"}</span>
            <span className="d">{"fundacionismo"}</span>
            {"             "}
            <span className="d">{"03"}</span>
            {"     "}
            <span className="a">{"■ incompleto\n"}</span>
            <span className="d">{"contextualismo"}</span>
            {"            "}
            <span className="d">{"00"}</span>
            {"     "}
            <span className="r">{"■ ausente\n"}</span>
            <span className="d">{"virtud epistémica"}</span>
            {"         "}
            <span className="d">{"06"}</span>
            {"     "}
            <span className="g">{"■ cubierto\n"}</span>
            <span className="d">{"desacuerdo"}</span>
            {"                "}
            <span className="d">{"00"}</span>
            {"     "}
            <span className="r">{"■ ausente\n"}</span>
            <span className="d">{"testimonio"}</span>
            {"                "}
            <span className="d">{"03"}</span>
            {"     "}
            <span className="a">{"■ incompleto\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"cobertura"}</span>
            {"  "}
            <span className="g">{"48,8 %"}</span>
            {"  ·  "}
            <span className="a">{"26,2 %"}</span>
            {"  ·  "}
            <span className="r">{"21,4 %"}</span>
            <span className="blink">{"█"}</span>
          </pre>
        </article>

        <article className="feat">
          <div className="feat-num">/ 02</div>
          <h3>Detección de conflictos</h3>
          <p>
            NoeticAI lee de lado tanto como hacia adelante. Cuando dos notas se
            contradicen — una cita mal atribuida, una definición que se desplazó
            entre semanas — saca la costura a la luz y muestra ambas versiones.
          </p>
          <pre className="feat-ascii" aria-hidden="true">
            <span className="f">{"conflicto detectado ─ fiabilismo\n\n"}</span>
            <span className="d">{"  semana 03 · nota 17\n"}</span>
            <span className="f">{"  ┌───────────────────────────────────┐\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"\"… fiabilismo de procesos: la"}</span>
            {"    "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"creencia es justificada si surge"}</span>
            {"  "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"de un proceso fiable.\""}</span>
            {"            "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  └───────────────────────────────────┘\n"}</span>
            {"           "}
            <span className="r">{"▲  ≠  ▼\n"}</span>
            <span className="f">{"  ┌───────────────────────────────────┐\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"\"… fiabilismo del agente: lo que"}</span>
            {" "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"se evalúa son las facultades del"}</span>
            {"  "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  │"}</span>
            {" "}
            <span className="d">{"sujeto, no el proceso.\""}</span>
            {"           "}
            <span className="f">{"│\n"}</span>
            <span className="f">{"  └───────────────────────────────────┘\n"}</span>
            {"  "}
            <span className="d">{"semana 05 · nota 04\n\n"}</span>
            <span className="k">{"→"}</span>
            {" "}
            <span className="d">{"reconciliar vía Goldman 1979 §3"}</span>
            <span className="blink">{"_"}</span>
          </pre>
        </article>

        <article className="feat">
          <div className="feat-num">/ 03</div>
          <h3>Sugerencias citadas</h3>
          <p>
            Cada párrafo redactado lleva los números de página de sus fuentes.
            Nada se inventa. Si una afirmación no puede fundamentarse en tu
            bibliografía, NoeticAI se niega a escribirla.
          </p>
          <pre className="feat-ascii" aria-hidden="true">
            <span className="f">{"borrador ─ coherentismo, ¶1\n\n"}</span>
            <span className="d">{"  El coherentismo sostiene que una\n"}</span>
            <span className="d">{"  creencia está justificada en virtud\n"}</span>
            <span className="d">{"  de su lugar dentro de un sistema\n"}</span>
            <span className="d">{"  más amplio de creencias mutuamente\n"}</span>
            <span className="d">{"  sustentadas"}</span>
            <span className="k">{"¹"}</span>
            <span className="d">{". Frente al regreso\n"}</span>
            <span className="d">{"  del fundacionismo, propone una red\n"}</span>
            <span className="d">{"  en lugar de una pirámide"}</span>
            <span className="k">{"²"}</span>
            <span className="d">{".\n\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"¹"}</span>
            {" "}
            <span className="d">{"BonJour 1985, pp. 87–110"}</span>
            {"          "}
            <span className="g">{"✓\n"}</span>
            <span className="k">{"²"}</span>
            {" "}
            <span className="d">{"Olsson 2017, §§ 2–4"}</span>
            {"               "}
            <span className="g">{"✓\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"confianza"}</span>
            {"  "}
            <span className="g">{"█████████"}</span>
            <span className="f">{"░"}</span>
            {"  "}
            <span className="d">{"0,94"}</span>
          </pre>
        </article>

        <article className="feat">
          <div className="feat-num">/ 04</div>
          <h3>La vista de constelación</h3>
          <p>
            Cambia de columna a grafo. Mira tus conceptos como nodos con aristas
            trazadas a partir de la coocurrencia en tus lecturas y notas. La
            forma de tu comprensión, hecha visible.
          </p>
          <pre className="feat-ascii constellation" aria-hidden="true">
            <span className="f">{"vista · constelación\n\n"}</span>
            {"        "}
            <span className="f">{"·"}</span>
            {"     "}
            <span className="d drift">{"○"}</span>
            <span className="f">{"─────"}</span>
            <span className="d">{"●\n"}</span>
            {"              "}
            <span className="f">{"╲\n"}</span>
            {"   "}
            <span className="d">{"●"}</span>
            <span className="f">{"───────"}</span>
            <span className="d">{"●"}</span>
            <span className="f">{"──"}</span>
            <span className="d drift">{"●"}</span>
            {"     "}
            <span className="f">{"·\n"}</span>
            {"   "}
            <span className="f">{"╱"}</span>
            {"     "}
            <span className="f">{"╱ ╲\n"}</span>
            {"  "}
            <span className="d">{"●"}</span>
            {"     "}
            <span className="d">{"●"}</span>
            {"   "}
            <span className="d drift">{"●"}</span>
            {"      "}
            <span className="r">{"○\n"}</span>
            {"  "}
            <span className="f">{"╲"}</span>
            {"    "}
            <span className="f">{"╱"}</span>
            {"             "}
            <span className="f">{"·\n"}</span>
            {"   "}
            <span className="d">{"●"}</span>
            <span className="f">{"─"}</span>
            <span className="d">{"●"}</span>
            {"      "}
            <span className="a">{"○"}</span>
            <span className="f">{"───"}</span>
            <span className="a">{"○\n"}</span>
            {"         "}
            <span className="f">{"·"}</span>
            {"      "}
            <span className="f">{"╲\n"}</span>
            {"              "}
            <span className="d drift">{"●\n\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"84"}</span>
            {" "}
            <span className="d">{"nodos"}</span>
            {" · "}
            <span className="k">{"217"}</span>
            {" "}
            <span className="d">{"aristas"}</span>
            {" · "}
            <span className="r">{"3"}</span>
            {" "}
            <span className="d">{"aislados"}</span>
          </pre>
        </article>

        <article className="feat">
          <div className="feat-num">/ 05</div>
          <h3>Confianza bibliográfica</h3>
          <p>
            Cada fuente que citas es puntuada por cuán a fondo aparece en tus
            notas. Las fuentes que apenas has abierto quedan marcadas. Las que
            has trabajado en profundidad pesan en consecuencia.
          </p>
          <pre className="feat-ascii" aria-hidden="true">
            <span className="f">{"fuentes · confianza bibliográfica\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="d">{"BonJour 1985"}</span>
            {"     "}
            <span className="g">{"█████████"}</span>
            <span className="f">{"░"}</span>
            {" "}
            <span className="g">{"0,92\n"}</span>
            <span className="d">{"Goldman 1979"}</span>
            {"     "}
            <span className="g">{"████████"}</span>
            <span className="f">{"░░"}</span>
            {" "}
            <span className="g">{"0,86\n"}</span>
            <span className="d">{"Lehrer 1990"}</span>
            {"      "}
            <span className="g">{"███████"}</span>
            <span className="f">{"░░░"}</span>
            {" "}
            <span className="g">{"0,78\n"}</span>
            <span className="d">{"Olsson 2017"}</span>
            {"      "}
            <span className="g">{"██████"}</span>
            <span className="f">{"░░░░"}</span>
            {" "}
            <span className="g">{"0,71\n"}</span>
            <span className="d">{"Sosa 2007"}</span>
            {"        "}
            <span className="a">{"████"}</span>
            <span className="f">{"░░░░░░"}</span>
            {" "}
            <span className="a">{"0,42\n"}</span>
            <span className="d">{"Pritchard 2005"}</span>
            {"   "}
            <span className="a">{"███"}</span>
            <span className="f">{"░░░░░░░"}</span>
            {" "}
            <span className="a">{"0,33\n"}</span>
            <span className="d">{"Williamson 2000"}</span>
            {"  "}
            <span className="r">{"█"}</span>
            <span className="f">{"░░░░░░░░░"}</span>
            {" "}
            <span className="r">{"0,11"}</span>
            {" "}
            <span className="r">{"⚠\n"}</span>
            <span className="d">{"Zagzebski 1996"}</span>
            {"   "}
            <span className="f">{"░░░░░░░░░░"}</span>
            {" "}
            <span className="r">{"—"}</span>
            {"    "}
            <span className="r">{"⚠\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"14"}</span>
            {" "}
            <span className="d">{"fuentes"}</span>
            {" · "}
            <span className="g">{"9"}</span>
            {" "}
            <span className="d">{"a fondo"}</span>
            {" · "}
            <span className="a">{"3"}</span>
            {" "}
            <span className="d">{"superf."}</span>
            {" · "}
            <span className="r">{"2"}</span>
            {" "}
            <span className="d">{"aus."}</span>
          </pre>
        </article>

        <article className="feat">
          <div className="feat-num">/ 06</div>
          <h3>Sincronización silenciosa</h3>
          <p>
            NoeticAI reejecuta tu revisión en segundo plano a medida que tus
            notas cambian. Los veredictos se actualizan sin ceremonia. Nunca
            tienes que preguntarte si el mapa está al día.
          </p>
          <pre className="feat-ascii" aria-hidden="true">
            <span className="f">{"sincronización · hace 2 min\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="d">{"11:42:08"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="g">{"+"}</span>
            {" "}
            <span className="d">{"412 palabras · Gettier\n"}</span>
            <span className="d">{"11:42:09"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="f">{"…"}</span>
            {" "}
            <span className="d">{"indexando notas"}</span>
            {"       "}
            <span className="pulse">{"●\n"}</span>
            <span className="d">{"11:42:11"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="f">{"…"}</span>
            {" "}
            <span className="d">{"reevaluando 12 conceptos\n"}</span>
            <span className="d">{"11:42:13"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="a">{"~"}</span>
            {" "}
            <span className="d">{"fiabilismo · prof. ↑\n"}</span>
            <span className="d">{"11:42:13"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="a">{"~"}</span>
            {" "}
            <span className="d">{"testimonio · fuentes ↑\n"}</span>
            <span className="d">{"11:42:14"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="g">{"✓"}</span>
            {" "}
            <span className="d">{"veredicto: contextualismo\n"}</span>
            {"         "}
            <span className="f">{"│"}</span>
            {"   "}
            <span className="a">{"■"}</span>
            {" ámbar  "}
            <span className="k">{"→"}</span>
            {"  "}
            <span className="g">{"■"}</span>
            {" verde\n"}
            <span className="d">{"11:42:14"}</span>
            {" "}
            <span className="f">{"│"}</span>
            {" "}
            <span className="g">{"✓"}</span>
            {" "}
            <span className="d">{"cobertura recalculada\n"}</span>
            <span className="f">{"─────────────────────────────────────────────\n"}</span>
            <span className="k">{"listo"}</span>
            {" · "}
            <span className="d">{"esperando cambios"}</span>
            <span className="blink">{"_"}</span>
          </pre>
        </article>
      </div>
    </section>
  );
}
