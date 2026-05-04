export function Footer() {
  return (
    <footer className="lp-foot" role="contentinfo">
      <div className="container">
        <div className="foot-grid">
          <div className="foot-col foot-brand">
            <div className="mark">NoeticAI</div>
            <p>
              Una auditoría del conocimiento para aprendices serios. Hecho por
              un pequeño equipo en Cambridge y&nbsp;Toronto.
            </p>
          </div>
          <div className="foot-col">
            <h4>Producto</h4>
            <ul>
              <li>
                <a href="#how">Cómo funciona</a>
              </li>
              <li>
                <a href="#features">Funciones</a>
              </li>
              <li>
                <a href="#pricing">Precios</a>
              </li>
              <li>
                <a href="/changelog">Historial de cambios</a>
              </li>
              <li>
                <a href="/roadmap">Hoja de ruta</a>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Recursos</h4>
            <ul>
              <li>
                <a href="/guide">Una guía para estudiantes de posgrado</a>
              </li>
              <li>
                <a href="/blog">El cuaderno de NoeticAI</a>
              </li>
              <li>
                <a href="/syllabi">Programas públicos</a>
              </li>
              <li>
                <a href="/integrations/notion">Integración con Notion</a>
              </li>
              <li>
                <a href="/api">API para desarrolladores</a>
              </li>
            </ul>
          </div>
          <div className="foot-col">
            <h4>Empresa</h4>
            <ul>
              <li>
                <a href="/about">Acerca de</a>
              </li>
              <li>
                <a href="/privacy">Privacidad</a>
              </li>
              <li>
                <a href="/terms">Términos</a>
              </li>
              <li>
                <a href="/security">Seguridad</a>
              </li>
              <li>
                <a href="mailto:hello@noeticai.app">hello@noeticai.app</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© 2026 NoeticAI Labs, Inc. · Todos los derechos reservados.</span>
          <span className="greek">
            νοητικός — del intelecto, del acto de conocer.
          </span>
        </div>
      </div>
    </footer>
  );
}
