import { useAnimateOnVisible } from "../lib/useAnimateOnVisible";

interface HeroProps {
  onWaitlist: () => void;
}

export function Hero({ onWaitlist }: HeroProps) {
  const animateRef = useAnimateOnVisible<HTMLElement>(true);
  return (
    <section className="hero" aria-labelledby="hero-title" ref={animateRef}>
      <div className="container">
        <div className="hero-grid">
          <div>
            <div className="hero-eyebrow">
              <span className="dot" aria-hidden="true" />
              Una segunda lectura de tus apuntes, para estudiantes serios
            </div>
            <h1 id="hero-title">
              Sabes lo que leíste. <span className="em">¿Sabes lo que te&nbsp;falta?</span>
            </h1>
            <p className="hero-lede">
              <strong>NoeticAI lee tus apuntes de Notion, los compara con el programa de tu curso, y te dice exactamente qué conceptos has dominado, cuáles están a medias, y cuáles ni siquiera has tocado.</strong>{" "}
              Después redacta el texto que falta — con citas a tu propia bibliografía — para que cierres cada vacío antes del examen.
            </p>
            <p className="hero-tldr">
              <span className="tldr-tag">En una frase</span>
              Una segunda lectura crítica de tus notas, que encuentra todo lo que te saltaste sin darte cuenta.
            </p>
            <div className="hero-cta">
              <button className="btn btn-primary btn-lg" type="button" onClick={onWaitlist}>Revisar un curso →</button>
              <button className="btn btn-outline btn-lg" type="button" onClick={onWaitlist}>Ver cómo funciona</button>
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
            aria-label="Una revisión de cobertura de un curso de epistemología que muestra 41 conceptos cubiertos, 22 incompletos y 18 ausentes."
          >
            <div className="hv-head">
              <div>
                <div className="hv-tag">Revisión · Primavera 2026</div>
                <div className="hv-title">Epistemología — mapa de cobertura</div>
              </div>
              <div className="hv-tag" style={{ color: "var(--green-fg)" }}>en vivo</div>
            </div>

            {/* Mini constellation */}
            <div className="hv-constellation" aria-hidden="true">
              <svg viewBox="0 0 460 220" preserveAspectRatio="xMidYMid meet">
                {/* corner crops (manuscript framing) */}
                <path className="corner" d="M 8 8 L 8 2 L 14 2" />
                <path className="corner" d="M 452 8 L 452 2 L 446 2" />
                <path className="corner" d="M 8 212 L 8 218 L 14 218" />
                <path className="corner" d="M 452 212 L 452 218 L 446 218" />

                {/* header strip */}
                <text className="lbl-mono" x="14" y="16">corpus · n=84</text>
                <text className="lbl-mono warm" x="446" y="16" textAnchor="end">subgrafos · 3</text>

                {/* crosshair around focal */}
                <line className="crosshair" x1="230" y1="40" x2="230" y2="180" />
                <line className="crosshair" x1="80" y1="110" x2="380" y2="110" />

                {/* focal rotating ring */}
                <circle className="focal-ring" cx="230" cy="110" r="48" />

                {/* edges */}
                <path className="edge" d="M 64 78  Q 130 70 196 96" />
                <path className="edge" d="M 92 138 Q 150 122 200 112" />
                <path className="edge warm" d="M 120 70 Q 170 80 222 102" />
                <path className="edge" d="M 64 78  Q 80 110 92 138" />
                <path className="edge" d="M 64 78  L 120 70" />
                <path className="edge" d="M 92 138 L 138 158" />
                <path className="edge warm" d="M 240 110 Q 300 78 360 64" />
                <path className="edge" d="M 244 122 Q 310 140 376 152" />
                <path className="edge" d="M 250 100 Q 320 96 388 90" />
                <path className="edge" d="M 360 64  L 388 90" />
                <path className="edge" d="M 376 152 L 388 90" />
                <path className="edge" d="M 360 64  Q 380 110 376 152" />
                <path className="edge" d="M 138 158 Q 200 178 260 174" />
                <path className="edge" d="M 260 174 Q 320 168 376 152" />

                {/* spark edges */}
                <path className="edge spark" d="M 120 70 Q 180 90 230 110" />
                <path className="edge spark b" d="M 230 110 Q 300 78 360 64" />
                <path className="edge spark c" d="M 230 110 Q 310 140 376 152" />

                {/* halos */}
                <circle className="halo focal" cx="230" cy="110" r="5" />
                <circle className="halo warn" cx="388" cy="90" r="5" />

                {/* nodes */}
                <circle className="node g drift" cx="64" cy="78" r="3" />
                <circle className="node g" cx="120" cy="70" r="2.6" />
                <circle className="node g drift b" cx="92" cy="138" r="2.4" />
                <circle className="node g" cx="138" cy="158" r="2" />
                <circle className="node g dim" cx="46" cy="120" r="1.6" />
                <circle className="node g dim" cx="160" cy="92" r="1.6" />
                <circle className="node g" cx="230" cy="110" r="4.2" />
                <circle className="node g drift c" cx="296" cy="92" r="2.4" />
                <circle className="node g" cx="320" cy="120" r="2.2" />
                <circle className="node g" cx="360" cy="64" r="3" />
                <circle className="node a" cx="376" cy="152" r="3" />
                <circle className="node a drift" cx="388" cy="90" r="3.4" />
                <circle className="node g dim" cx="408" cy="118" r="1.6" />
                <circle className="node g dim" cx="332" cy="78" r="1.6" />
                <circle className="node a drift b" cx="200" cy="174" r="2.4" />
                <circle className="node a" cx="260" cy="174" r="2.2" />
                <circle className="node r" cx="58" cy="186" r="3" />

                {/* labels */}
                <text className="lbl-serif" x="60" y="68">justificación</text>
                <text className="lbl-serif faint" x="142" y="60">CVJ</text>
                <text className="lbl-serif" x="232" y="100" textAnchor="middle">fiabilismo</text>
                <text className="lbl-mono warm" x="232" y="132" textAnchor="middle">en revisión</text>
                <text className="lbl-serif" x="356" y="56">virtud</text>
                <text className="lbl-serif muted" x="394" y="86">contextualismo</text>
                <text className="lbl-serif muted" x="372" y="170">testimonio</text>
                <text className="lbl-serif faint" x="56" y="202" textAnchor="start">desacuerdo</text>
                <text className="lbl-mono" x="58" y="212" textAnchor="start">aislado</text>
              </svg>
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

            {/* Live ticker */}
            <div className="hv-ticker" aria-hidden="true">
              <span className="live"><span className="dot" />en vivo</span>
              <div className="feed">
                <div className="feed-track">
                  <span className="feed-item"><span className="ts">11:42</span> <span className="add">+</span> <span className="tag">Gettier</span> <span>412 palabras añadidas</span></span>
                  <span className="feed-item"><span className="ts">11:43</span> <span className="chg">~</span> <span className="tag">fiabilismo</span> <span>profundidad ↑</span></span>
                  <span className="feed-item"><span className="ts">11:44</span> <span className="add">✓</span> <span className="tag">contextualismo</span> <span>ámbar → verde</span></span>
                  <span className="feed-item"><span className="ts">11:45</span> <span className="gone">⚠</span> <span className="tag">Williamson 2000</span> <span>citado, no leído</span></span>
                  <span className="feed-item"><span className="ts">11:46</span> <span className="chg">~</span> <span className="tag">testimonio</span> <span>3 fuentes nuevas</span></span>
                  <span className="feed-item"><span className="ts">11:47</span> <span className="add">+</span> <span className="tag">virtud</span> <span>nodo conectado</span></span>
                  {/* duplicate for seamless marquee */}
                  <span className="feed-item"><span className="ts">11:42</span> <span className="add">+</span> <span className="tag">Gettier</span> <span>412 palabras añadidas</span></span>
                  <span className="feed-item"><span className="ts">11:43</span> <span className="chg">~</span> <span className="tag">fiabilismo</span> <span>profundidad ↑</span></span>
                  <span className="feed-item"><span className="ts">11:44</span> <span className="add">✓</span> <span className="tag">contextualismo</span> <span>ámbar → verde</span></span>
                  <span className="feed-item"><span className="ts">11:45</span> <span className="gone">⚠</span> <span className="tag">Williamson 2000</span> <span>citado, no leído</span></span>
                  <span className="feed-item"><span className="ts">11:46</span> <span className="chg">~</span> <span className="tag">testimonio</span> <span>3 fuentes nuevas</span></span>
                  <span className="feed-item"><span className="ts">11:47</span> <span className="add">+</span> <span className="tag">virtud</span> <span>nodo conectado</span></span>
                </div>
              </div>
              <span className="clock">11:47:03</span>
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
