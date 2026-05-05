export function InPlainWords() {
  return (
    <section className="plain" aria-labelledby="plain-title">
      <div className="container">
        <h2 id="plain-title" className="plain-h">
          En palabras llanas, esto es lo que hace NoeticAI:
        </h2>
        <ol className="plain-steps" role="list">
          <li className="pstep">
            <span className="pn">1.</span>
            <span className="ph">Conectas tu Notion</span>
            <span className="pp">donde ya tomas apuntes de clase, lecturas y seminarios.</span>
          </li>
          <li className="pstep">
            <span className="pn">2.</span>
            <span className="ph">Subes el programa del curso</span>
            <span className="pp">o pegas la lista de lecturas. Un PDF basta.</span>
          </li>
          <li className="pstep">
            <span className="pn">3.</span>
            <span className="ph">NoeticAI lo compara todo</span>
            <span className="pp">concepto por concepto, igual que un tutor que revisa tus apuntes con el syllabus al lado.</span>
          </li>
          <li className="pstep">
            <span className="pn">4.</span>
            <span className="ph">Recibes un mapa de cobertura</span>
            <span className="pp">verde si lo dominas, ámbar si está a medias, rojo si te lo saltaste — con texto sugerido para cerrar lo rojo.</span>
          </li>
        </ol>
        <p className="plain-foot">
          <span>No es un chatbot. No te pone a prueba. No genera tarjetas de memoria.</span>
          <span>Es un revisor que <em>lee lo que has escrito</em> y te dice qué falta.</span>
        </p>
      </div>
    </section>
  );
}
