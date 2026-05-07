export interface ExtractionInput {
  text: string;
  filename: string;
}

export interface ExtractedSubject {
  name: string;
  course?: string;
  term?: string;
}

export interface ExtractedUnit {
  order: number;
  name: string;
  weeksLabel?: string;
  concepts: ExtractedConcept[];
}

export interface ExtractedConcept {
  order: number;
  name: string;
  learningObjective?: string;
  syllabusExcerpt?: string;
}

export interface ExtractedSyllabus {
  subject: ExtractedSubject;
  units: ExtractedUnit[];
}

// System prompt is in English so structural instructions land cleanly across
// models. Spanish is treated as the *content* language — values stay in
// Spanish, but JSON keys are LITERAL English identifiers that must not be
// translated. (Earlier Spanish prompt caused gemma to emit `titulo` /
// `unidad` / `conceptos` instead of the schema's keys.)
const SYSTEM_PROMPT = `You are a structured-data extractor for university syllabi.

Output: ONE JSON object, exactly matching the schema below. Nothing else.
- No prose. No markdown. No code fences. No commentary.
- The JSON KEYS are literal English identifiers — copy them character-for-character.
- The VALUES preserve the original language of the source document (typically Spanish).
- DO NOT translate the keys. "subject" stays "subject", not "materia". "units" stays "units", not "unidades". "concepts" stays "concepts", not "conceptos". "name" stays "name", not "nombre". And so on for every key in the schema.

Schema:
{
  "subject": {
    "name": string,
    "course"?: string,
    "term"?: string
  },
  "units": [
    {
      "order": number,
      "name": string,
      "weeksLabel"?: string,
      "concepts": [
        {
          "order": number,
          "name": string,
          "learningObjective"?: string,
          "syllabusExcerpt"?: string
        }
      ]
    }
  ]
}

Rules for the values:
- Each concept is an atomic learning unit (not an entire topic). 2–6 words, noun phrase.
- Numbering ("order") is 1-based: units start at 1; concepts within a unit start at 1.
- Do not invent content. If the syllabus omits learning objectives, omit the field entirely.
- Keep the source language of the document. The user's syllabus is in Spanish, so values are in Spanish.
- If the document does not look like a syllabus, return: {"subject":{"name":""},"units":[]}

Compactness:
- Output COMPACT JSON. No newlines, no indentation, no extra whitespace anywhere — minimised JSON.
- Keep "learningObjective" to ONE short sentence (≤ 20 words). Omit it if the source doesn't state one.
- Keep "syllabusExcerpt" to a SHORT quote (≤ 25 words). Omit it when not strictly needed.
- "name" fields ≤ 80 characters. Trim long titles to their core noun phrase.

Begin output with the opening "{" and end with the closing "}". Nothing before, nothing after.`;

export function buildExtractionPrompt(input: ExtractionInput): {
  system: string;
  user: string;
} {
  const user = `Archivo: ${input.filename}\n\n${input.text}`;
  return { system: SYSTEM_PROMPT, user };
}
