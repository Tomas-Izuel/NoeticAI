const PlusIcon = () => (
  <svg
    className="glyph"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const FAQ_ITEMS = [
  {
    question: "¿Qué hace NoeticAI exactamente?",
    answer:
      "NoeticAI lee las notas que mantienes en Notion, las compara con el programa de estudios y la bibliografía de un curso que estás tomando, y produce un mapa de cobertura: qué conceptos has cubierto, cuáles son parciales y cuáles faltan por completo. Después redacta párrafos citados para cerrar los ausentes — párrafos que tú editas y aceptas, nunca aceptas a ciegas.",
    defaultOpen: true,
  },
  {
    question: "¿Mis datos son privados?",
    answer:
      "Tus notas se leen mediante una integración de Notion con permisos limitados que tú controlas. Nunca entrenamos modelos con tus datos, nunca los vendemos y puedes revocar el acceso en cualquier momento desde tu panel. Las auditorías se almacenan cifradas en reposo. La certificación SOC 2 Tipo II está en curso.",
  },
  {
    question: "¿Qué herramientas de notas son compatibles?",
    answer:
      "Notion es compatible hoy. Obsidian, Apple Notes y directorios de markdown plano están en beta privada — escríbenos si quieres una invitación. Roam, Logseq y Bear están en la hoja de ruta para el tercer trimestre.",
  },
  {
    question: "¿Es solo una app de tarjetas con pasos extra?",
    answer:
      "No. NoeticAI no genera tarjetas de memoria ni te pone a prueba. Audita la integridad estructural de tus notas escritas frente al corpus real de una disciplina. La salida es un mapa de lo que sabes y lo que no, no un ejercicio de memorización.",
  },
  {
    question: "¿Puedo usarlo sin un programa de estudios?",
    answer:
      "Sí. Puedes proporcionar una lista de lecturas, un esquema de tesis, una pregunta de investigación o simplemente un tema. NoeticAI inferirá un conjunto de conceptos a partir de fuentes canónicas (la SEP, ensayos de revisión de JSTOR, listas de lectura departamentales de instituciones afines) y auditará tus notas frente a eso.",
  },
  {
    question: "¿Qué disciplinas admite?",
    answer:
      "NoeticAI funciona para cualquier disciplina con uso intensivo de texto: filosofía, historia, literatura, derecho, teología, sociología, historia del arte, informática teórica, las ciencias sociales cualitativas. Es menos útil para ciencias de laboratorio, matemáticas aplicadas y cualquier campo cuyos artefactos primarios no sean prosa.",
  },
  {
    question: "¿Va a escribir mi ensayo por mí?",
    answer:
      "No, y es deliberado. NoeticAI redacta párrafos para cerrar vacíos en tus notas — cortos, con fuentes, fáciles de verificar y revisar. No va a escribir tu ensayo, tu tesis ni tu informe jurídico. La idea es que tu comprensión sea más honesta, no reemplazarla.",
  },
];

export function FAQ() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="container-narrow">
        <header className="section-head">
          <div className="section-eyebrow">Preguntas</div>
          <h2 id="faq-title">
            Lo que la gente pregunta{" "}
            <span className="em">antes de empezar</span>.
          </h2>
        </header>

        <div className="faq-list">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.question}
              className="faq-item"
              open={item.defaultOpen}
            >
              <summary>
                {item.question}
                <PlusIcon />
              </summary>
              <div className="answer">{item.answer}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
