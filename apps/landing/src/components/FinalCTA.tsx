interface FinalCTAProps {
  onWaitlist: () => void;
}

export function FinalCTA({ onWaitlist }: FinalCTAProps) {
  return (
    <section className="final-cta" aria-labelledby="final-title">
      <div className="container final-cta-inner">
        <h2 id="final-title">
          El mapa <span className="em">aún no está completo</span>.
        </h2>
        <p>
          Conecta un curso en menos de dos minutos. La primera auditoría es
          gratis, y los vacíos que encuentre son tuyos para siempre.
        </p>
        <div className="actions">
          <button
            className="btn btn-primary btn-lg"
            onClick={onWaitlist}
            type="button"
          >
            Unirme a la lista de espera
          </button>
        </div>
      </div>
    </section>
  );
}
