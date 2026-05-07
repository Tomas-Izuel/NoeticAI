interface NotFoundProps {
  onWaitlist: () => void;
}

export function NotFound({ onWaitlist }: NotFoundProps) {
  return (
    <div className="nf-overlay">
      <div className="nf-inner">
        <div className="nf-code">404</div>
        <h1 className="nf-title">Página no encontrada</h1>
        <p className="nf-body">
          Esta dirección no existe en el mapa. Puede que el enlace caducó, o
          simplemente nunca estuvo aquí.
        </p>
        <div className="nf-actions">
          <a className="btn btn-primary btn-lg" href="/">
            Volver al inicio
          </a>
          <button className="btn btn-outline btn-lg" type="button" onClick={onWaitlist}>
            Únete a la lista de espera
          </button>
        </div>
      </div>
    </div>
  );
}
