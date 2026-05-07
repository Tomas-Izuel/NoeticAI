import type { NoteContent, Subject, Unit, NoteSummary } from "@noeticai/connector-core";

// Phase 1 fixtures. Spanish notes on epistemology — matches the design's
// example domain (coherentismo, fundacionalismo, regreso epistémico). Eight
// short notes across two units; enough breadth that retrieval has to
// discriminate, not just dump back any paragraph.

const SUBJECT_ID = "stub-subject-epistemologia";
const UNIT_REGRESS_ID = "stub-unit-regreso";
const UNIT_THEORIES_ID = "stub-unit-teorias";

export const stubSubject: Subject = {
  id: SUBJECT_ID,
  name: "Epistemología",
  course: "FIL-201",
  term: "2026-1",
  glyph: "ε",
};

export const stubUnits: Unit[] = [
  {
    id: UNIT_REGRESS_ID,
    subjectId: SUBJECT_ID,
    order: 1,
    name: "El problema del regreso",
    weeksLabel: "Semanas 1–3",
    sourceUnitRef: null,
  },
  {
    id: UNIT_THEORIES_ID,
    subjectId: SUBJECT_ID,
    order: 2,
    name: "Teorías de la justificación",
    weeksLabel: "Semanas 4–6",
    sourceUnitRef: null,
  },
];

interface StubNote {
  externalId: string;
  unitId: string;
  title: string;
  blocks: NoteContent["blocks"];
}

export const stubNotes: StubNote[] = [
  {
    externalId: "stub-note-001",
    unitId: UNIT_REGRESS_ID,
    title: "Introducción al regreso epistémico",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Introducción al regreso epistémico",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "El problema del regreso surge cuando exigimos que toda creencia justificada lo sea por otra creencia justificada. Si la cadena no se detiene, la justificación parece imposible.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "El trilema de Agripa formaliza el problema: toda cadena de justificación termina en una regresión infinita, en un círculo, o en una creencia básica no justificada.",
      },
    ],
  },
  {
    externalId: "stub-note-002",
    unitId: UNIT_REGRESS_ID,
    title: "El trilema de Agripa",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "El trilema de Agripa",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "Las tres salidas del trilema —regreso infinito, circularidad y dogmatismo— estructuran las teorías clásicas de la justificación: infinitismo, coherentismo y fundacionalismo respectivamente.",
      },
      {
        kind: "bullet",
        position: 2,
        text: "Sexto Empírico atribuye el trilema a los escépticos pirrónicos, no a Agripa directamente.",
      },
    ],
  },
  {
    externalId: "stub-note-003",
    unitId: UNIT_THEORIES_ID,
    title: "Fundacionalismo clásico",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Fundacionalismo clásico",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "El fundacionalismo sostiene que existen creencias básicas cuya justificación no depende de otras creencias. La percepción y la introspección son los candidatos clásicos a creencias básicas.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "La crítica más fuerte al fundacionalismo es el dilema de Sellars: una creencia básica o tiene contenido proposicional —y entonces necesita justificación— o no lo tiene —y entonces no puede justificar nada.",
      },
    ],
  },
  {
    externalId: "stub-note-004",
    unitId: UNIT_THEORIES_ID,
    title: "Coherentismo",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Coherentismo",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "El coherentismo niega que existan creencias básicas y postula que la justificación se da por la coherencia mutua dentro de un sistema de creencias. La justificación es holística, no lineal.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "BonJour exige tres condiciones para la coherencia: consistencia lógica, conexiones inferenciales y ausencia de subsistemas inconexos. Sin todas ellas, la coherencia es trivial.",
      },
      {
        kind: "quote",
        position: 3,
        text: "La objeción del input empírico pregunta cómo un sistema puramente coherente se conecta con el mundo, sin colapsar en una novela bien escrita pero falsa.",
      },
    ],
  },
  {
    externalId: "stub-note-005",
    unitId: UNIT_THEORIES_ID,
    title: "Infinitismo",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Infinitismo",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "Klein defiende que la justificación admite cadenas infinitas, siempre que cada eslabón aporte razones nuevas. El infinitismo evita la circularidad y el dogmatismo a costa de exigir capacidades cognitivas idealizadas.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "Una crítica frecuente apunta a que ningún agente real recorre cadenas infinitas; pero Klein responde que la justificación es una propiedad disposicional, no un proceso completo.",
      },
    ],
  },
  {
    externalId: "stub-note-006",
    unitId: UNIT_THEORIES_ID,
    title: "Justificación interna y externa",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Internalismo y externalismo",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "El internalismo exige que el sujeto tenga acceso reflexivo a las razones que justifican su creencia. El externalismo, en cambio, admite factores fiables externos al sujeto, como en el confiabilismo de Goldman.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "El nuevo problema del genio maligno muestra que la fiabilidad sola no basta: dos sujetos con creencias idénticas pueden diferir en justificación si solo uno habita un mundo cooperativo.",
      },
    ],
  },
  {
    externalId: "stub-note-007",
    unitId: UNIT_REGRESS_ID,
    title: "Pirrón y el escepticismo antiguo",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Pirrón y el escepticismo antiguo",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "Pirrón propone la suspensión del juicio (epojé) como respuesta práctica al regreso: si toda creencia es disputable, la ataraxia se alcanza dejando de creer.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "Los modos pirrónicos —especialmente los cinco modos de Agripa— son el aparato técnico que sostiene la suspensión. Aún hoy estructuran la presentación moderna del trilema.",
      },
    ],
  },
  {
    externalId: "stub-note-008",
    unitId: UNIT_THEORIES_ID,
    title: "Confiabilismo de procesos",
    blocks: [
      {
        kind: "heading",
        position: 0,
        text: "Confiabilismo de procesos",
      },
      {
        kind: "paragraph",
        position: 1,
        text: "Goldman caracteriza la justificación como producida por procesos cognitivos fiables: una creencia está justificada si proviene de un proceso que tiende a producir verdades.",
      },
      {
        kind: "paragraph",
        position: 2,
        text: "El problema de la generalidad pregunta cómo individuar el proceso relevante: el mismo acto puede describirse como percepción visual, como percepción visual de un granero, o como percepción visual humana.",
      },
    ],
  },
];

export function listStubNoteSummaries(): NoteSummary[] {
  return stubNotes.map((n) => ({
    ref: { source: "stub", externalId: n.externalId, kind: "page" },
    title: n.title,
    updatedAtExternal: "2026-05-01T00:00:00.000Z",
    unitId: n.unitId,
  }));
}

export function fetchStubNote(externalId: string): NoteContent | null {
  const n = stubNotes.find((x) => x.externalId === externalId);
  if (!n) return null;
  return {
    ref: { source: "stub", externalId: n.externalId, kind: "page" },
    title: n.title,
    blocks: n.blocks,
  };
}
