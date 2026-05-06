interface NavProps {
  onWaitlist: () => void;
}

export function Nav({ onWaitlist: _onWaitlist }: NavProps) {
  return (
    <header className="lp-nav" role="banner">
      <nav className="lp-nav-inner" aria-label="Principal">
        <a className="lp-brand" href="/" aria-label="Inicio de NoeticAI">
          <span className="mark">NoeticAI</span>
        </a>
        <div className="lp-nav-links" role="list">
          <a href="#how" role="listitem">Cómo funciona</a>
          <a href="#features" role="listitem">Funciones</a>
          <a href="#audiences" role="listitem">Para quién</a>
          <a href="#pricing" role="listitem">Precios</a>
          <a href="#faq" role="listitem">Preguntas</a>
        </div>
        <div className="lp-nav-cta">
          <a className="btn btn-primary btn-sm" href="/start">Revisar mis apuntes →</a>
        </div>
      </nav>
    </header>
  );
}
