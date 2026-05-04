export function CoverageStates() {
  return (
    <section className="section" aria-labelledby="states-title">
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">El vocabulario</div>
          <h2 id="states-title">
            Tres veredictos. <span className="em">Nada más.</span>
          </h2>
          <p className="section-lede">
            NoeticAI se niega a fingir que un concepto se conoce a medias. Cada
            nodo de tu mapa es uno de tres estados. La frontera entre ellos es
            el trabajo.
          </p>
        </header>
      </div>

      <div className="triptych">
        <article className="tri">
          <div className="tri-head">
            <span className="tri-dot green" aria-hidden="true" />
            <span className="tri-name">Cubierto</span>
          </div>
          <h3>Lo tienes.</h3>
          <p>
            El concepto aparece en tus notas con suficiente profundidad,
            respaldado por al menos dos fuentes independientes, y lo has
            utilizado en tu propia prosa.
          </p>
          <p className="quote">
            «El criterio no es que hayas escrito las palabras, sino que hayas
            hecho algo con ellas.»
          </p>
        </article>
        <article className="tri">
          <div className="tri-head">
            <span className="tri-dot amber" aria-hidden="true" />
            <span className="tri-name">Incompleto</span>
          </div>
          <h3>Tienes algo.</h3>
          <p>
            Una definición sin ejemplos. Una cita sin contexto. Dos lecturas que
            se contradicen y no lo has notado. NoeticAI señala la costura y te
            dice por dónde se rompe.
          </p>
          <p className="quote">
            La mayor parte de lo que llamamos comprensión vive aquí, sin
            examinar, hasta que un examen lo revela.
          </p>
        </article>
        <article className="tri">
          <div className="tri-head">
            <span className="tri-dot red" aria-hidden="true" />
            <span className="tri-name">Ausente</span>
          </div>
          <h3>No lo tienes.</h3>
          <p>
            No está en tus notas. Ni en tus márgenes. Ni parafraseado en
            ninguna parte. La disciplina espera que este concepto sostenga el
            peso, y tu corpus guarda silencio.
          </p>
          <p className="quote">
            Un cuadrado rojo no es un fracaso. Es una coordenada. Es el
            siguiente lugar adonde ir.
          </p>
        </article>
      </div>
    </section>
  );
}
