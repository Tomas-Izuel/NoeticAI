interface FinalCTAProps {
  onWaitlist: () => void;
}

export function FinalCTA({ onWaitlist: _onWaitlist }: FinalCTAProps) {
  return (
    <section className="final-cta" aria-labelledby="final-title">
      <div className="container final-cta-inner">
        <h2 id="final-title">
          El mapa <span className="em">aún no está completo</span>.
        </h2>
        <p>
          Conecta un curso en menos de dos minutos. La primera revisión es
          gratis, y los vacíos que encuentre son tuyos para siempre.
        </p>
        <div className="actions">
          <a className="btn btn-primary btn-lg" href="/start">
            Revisar mis apuntes →
          </a>
          <a className="btn btn-outline btn-lg" href="/demo">
            Ver demo de 90 segundos
          </a>
        </div>
      </div>
    </section>
  );
}
