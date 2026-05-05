export function Audiences() {
  return (
    <section className="section" id="audiences" aria-labelledby="audiences-title">
      <div className="container">
        <header className="section-head">
          <div className="section-eyebrow">Para quién es</div>
          <h2 id="audiences-title">
            Construido para disciplinas donde{" "}
            <span className="em">el texto es la&nbsp;materia</span>.
          </h2>
          <p className="section-lede">
            Si tu trabajo consiste en leer con cuidado y escribir con precisión,
            NoeticAI está hecho para ti. Si consiste en resolver ecuaciones
            diferenciales, no.
          </p>
        </header>
      </div>

      <div className="audiences">
        <article className="aud">
          <div className="label">Estudiantes de posgrado</div>
          <h3>Aprueba tus exámenes integrales.</h3>
          <p>
            Revisa una lista de doscientas obras. Encuentra las diez con las que
            no te has comprometido de verdad antes de que lo haga tu comité.
          </p>
        </article>
        <article className="aud">
          <div className="label">Estudiantes de derecho</div>
          <h3>Esboza con integridad.</h3>
          <p>
            Contrasta tus resúmenes de casos con el programa. Encuentra las
            doctrinas que has nombrado sin explicar y los casos que has citado
            sin leer.
          </p>
        </article>
        <article className="aud">
          <div className="label">Investigadores</div>
          <h3>Revisa tu bibliografía.</h3>
          <p>
            Mapea el territorio antes de escribir el artículo. Saca a la luz los
            conflictos en la literatura secundaria. Sabe qué citas te has
            ganado.
          </p>
        </article>
        <article className="aud">
          <div className="label">Autodidactas</div>
          <h3>Lee como un departamento.</h3>
          <p>
            Toma prestado un programa de MIT OpenCourseWare o de la SEP.
            NoeticAI trata tu lectura autodirigida con el mismo rigor que un
            seminario.
          </p>
        </article>
      </div>
    </section>
  );
}
