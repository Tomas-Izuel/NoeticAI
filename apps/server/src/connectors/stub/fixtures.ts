import { createHash } from "node:crypto";
import type { NoteContent, Subject, Unit, NoteSummary } from "@noeticai/connector-core";

// Phase 1 fixtures. Spanish notes on epistemology — matches the design's
// example domain (coherentismo, fundacionalismo, regreso epistémico). Eight
// short notes across two units; enough breadth that retrieval has to
// discriminate, not just dump back any paragraph.
//
// Subject id is content-addressed on (userId, name) — same formula as the
// syllabus extraction path (apps/server/src/syllabus/job.ts). This lets the
// stub-ingested notes share subject identity with a syllabus the user
// uploads under the same name, so the audit pipeline finds both sides.
//
// Unit ids are scoped to the per-user subject id to avoid cross-tenant
// collisions on the units PK.

const SUBJECT_NAME = "Epistemología";
const UNIT_REGRESS_LOCAL = "regreso";
const UNIT_THEORIES_LOCAL = "teorias";

function getStubSubjectId(userId: string): string {
  return createHash("sha256")
    .update(userId + SUBJECT_NAME)
    .digest("hex")
    .slice(0, 24);
}

function getStubUnitId(userId: string, local: string): string {
  return `${getStubSubjectId(userId)}:u-${local}`;
}

export function getStubSubject(userId: string): Subject {
  return {
    id: getStubSubjectId(userId),
    name: SUBJECT_NAME,
    course: "FIL-201",
    term: "2026-1",
    glyph: "ε",
  };
}

export function getStubUnits(userId: string): Unit[] {
  const subjectId = getStubSubjectId(userId);
  return [
    {
      id: getStubUnitId(userId, UNIT_REGRESS_LOCAL),
      subjectId,
      order: 1,
      name: "El problema del regreso",
      weeksLabel: "Semanas 1–3",
      sourceUnitRef: null,
    },
    {
      id: getStubUnitId(userId, UNIT_THEORIES_LOCAL),
      subjectId,
      order: 2,
      name: "Teorías de la justificación",
      weeksLabel: "Semanas 4–6",
      sourceUnitRef: null,
    },
  ];
}

interface StubNoteFixture {
  externalId: string;
  unitLocal: string;
  title: string;
  blocks: NoteContent["blocks"];
}

const stubNoteFixtures: StubNoteFixture[] = [
  {
    externalId: "stub-note-001",
    unitLocal: UNIT_REGRESS_LOCAL,
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
    unitLocal: UNIT_REGRESS_LOCAL,
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
    unitLocal: UNIT_THEORIES_LOCAL,
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
    unitLocal: UNIT_THEORIES_LOCAL,
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
    unitLocal: UNIT_THEORIES_LOCAL,
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
    unitLocal: UNIT_THEORIES_LOCAL,
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
    unitLocal: UNIT_REGRESS_LOCAL,
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
    unitLocal: UNIT_THEORIES_LOCAL,
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

export function listStubNoteSummaries(userId: string): NoteSummary[] {
  return stubNoteFixtures.map((n) => ({
    ref: { source: "stub", externalId: n.externalId, kind: "page" },
    title: n.title,
    updatedAtExternal: "2026-05-01T00:00:00.000Z",
    unitId: getStubUnitId(userId, n.unitLocal),
  }));
}

export function fetchStubNote(externalId: string): NoteContent | null {
  const n = stubNoteFixtures.find((x) => x.externalId === externalId);
  if (!n) return null;
  return {
    ref: { source: "stub", externalId: n.externalId, kind: "page" },
    title: n.title,
    blocks: n.blocks,
  };
}
