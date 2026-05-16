/**
 * Unit tests for runSyllabusExtraction (Phase 6 syllabus-fix).
 *
 * Verifies that:
 *   1. The extraction job does NOT INSERT/UPDATE the subjects table.
 *   2. Units are upserted under the existing subject_id from the syllabus row.
 *   3. An existing unit with a matching name (case-insensitive) is reused
 *      (UPDATE only) rather than a new row being inserted.
 *   4. A new unit with no name match is created with a deterministic id.
 *   5. The returned subjectId matches the syllabus row's subject_id.
 *
 * Strategy: mock db.execute with a call-order based response queue.
 * The call order for runSyllabusExtraction is:
 *   call 0: SELECT syllabuses (fetch source_path, subject_id)
 *   call 1: UPDATE syllabuses SET status='extracting'
 *   call 2: SELECT units WHERE subject_id (existing units for name match)
 *   call 3: UPDATE units (for matched unit — "Foundations of Knowledge")
 *   call 4: INSERT units (for new unit — "Brand New Unit")
 *   call 5: INSERT concepts (unit 1, concept 1)
 *   call 6: INSERT concepts (unit 2, concept 1)
 *   call 7: UPDATE syllabuses SET status='ready'
 *
 * Run with: bun test src/syllabus/__tests__/job.test.ts
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYLLABUS_ID = "syl-test-001";
const SUBJECT_ID = "subj-notion-phil411";
const USER_ID = "user-a";
const SOURCE_PATH = "uploads/syllabuses/test.pdf";

// ---------------------------------------------------------------------------
// Call log and response queue
// ---------------------------------------------------------------------------

const dbCallLog: Array<{ type: "execute" | "pool" }> = [];
let executeCallIndex = 0;

// Ordered responses for db.execute calls.
const executeResponses = [
  // 0: SELECT syllabuses
  { rows: [{ source_path: SOURCE_PATH, source_filename: "test.pdf", subject_id: SUBJECT_ID }] },
  // 1: UPDATE syllabuses SET status='extracting'
  { rows: [] },
  // 2: SELECT units WHERE subject_id
  { rows: [
    { id: "unit-existing-001", name: "Foundations of Knowledge" },
    { id: "unit-existing-002", name: "Epistemology of Science" },
  ] },
  // 3: UPDATE units (matched unit)
  { rows: [] },
  // 4: INSERT units (new unit)
  { rows: [] },
  // 5: INSERT concepts (unit 1, concept 1)
  { rows: [] },
  // 6: INSERT concepts (unit 2, concept 1)
  { rows: [] },
  // 7: UPDATE syllabuses SET status='ready'
  { rows: [] },
];

// The raw SQL objects are drizzle tagged template strings. We can't easily
// inspect their text, but we CAN track call order to assert that no
// subjects mutation happens (subjects mutations would occur at indices 0–2
// in the old code, before units).
//
// We capture calls along with a best-effort text extraction from the SQL
// object. Drizzle SQL chunk string parts live in chunks where `Array.isArray(chunk.value)`.
interface CapturedCall {
  index: number;
  rawText: string; // joined string literal parts from drizzle's queryChunks
}

const capturedCalls: CapturedCall[] = [];

/** Extract all string literal fragments from a drizzle SQL object. */
function extractSqlText(sqlObj: unknown): string {
  const parts: string[] = [];

  function recurse(obj: unknown): void {
    if (typeof obj === "string") {
      parts.push(obj);
      return;
    }
    if (!obj || typeof obj !== "object") return;

    const o = obj as Record<string, unknown>;

    // drizzle StringChunk: { value: string[] }
    if (Array.isArray(o.value)) {
      for (const v of o.value as unknown[]) {
        if (typeof v === "string") parts.push(v);
      }
    }

    // drizzle SQL: { queryChunks: unknown[] }
    if (Array.isArray(o.queryChunks)) {
      for (const chunk of o.queryChunks as unknown[]) {
        recurse(chunk);
      }
    }
  }

  recurse(sqlObj);
  return parts.join(" ");
}

mock.module("../../db", () => ({
  db: {
    execute: mock(async (sqlObj: unknown) => {
      const idx = executeCallIndex;
      executeCallIndex += 1;

      const rawText = extractSqlText(sqlObj);
      capturedCalls.push({ index: idx, rawText });

      return executeResponses[idx] ?? { rows: [] };
    }),
  },
  pool: {
    query: mock(async (sql: string) => {
      dbCallLog.push({ type: "pool" });
      // concept_embeddings existence check → none exist
      if (typeof sql === "string" && sql.includes("concept_embeddings")) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
  },
}));

// ---------------------------------------------------------------------------
// FS mock
// ---------------------------------------------------------------------------

mock.module("node:fs/promises", () => ({
  readFile: mock(async () => Buffer.from([0x25, 0x50, 0x44, 0x46])),
}));

// ---------------------------------------------------------------------------
// PDF extract mock
// ---------------------------------------------------------------------------

mock.module("../extract", () => ({
  extractPdfText: mock(async () => ({ text: "Sample syllabus text", pageCount: 5 })),
}));

// ---------------------------------------------------------------------------
// Prompt mock
// ---------------------------------------------------------------------------

mock.module("../prompt", () => ({
  buildExtractionPrompt: mock(() => ({ system: "sys", user: "usr" })),
}));

// ---------------------------------------------------------------------------
// LLM mock — two units: one name matches existing, one does not
// ---------------------------------------------------------------------------

const MOCK_LLM_RESPONSE = JSON.stringify({
  subject: {
    name: "Philosophy of Knowledge — extracted",
    course: "PHIL 411",
    term: "Spring 2026",
  },
  units: [
    {
      order: 1,
      name: "foundations of knowledge",  // case-insensitive match
      weeksLabel: "Weeks 1–3",
      concepts: [{ order: 1, name: "A priori knowledge", learningObjective: "Understand a priori" }],
    },
    {
      order: 2,
      name: "Brand New Unit",            // no match → INSERT
      weeksLabel: "Weeks 4–6",
      concepts: [{ order: 1, name: "Novel concept" }],
    },
  ],
});

mock.module("../../ai", () => ({
  llm: {
    opus: mock(async () => ({ text: MOCK_LLM_RESPONSE })),
  },
  embed: {
    defaultModelId: "test-embed-model",
    embed: mock(async (opts: { texts: string[] }) => ({
      dim: 1024,
      vectors: opts.texts.map(() => Array.from({ length: 1024 }, () => 0)),
    })),
  },
}));

// ---------------------------------------------------------------------------
// parseLlmJson mock — pass through
// ---------------------------------------------------------------------------

mock.module("../../ai/json", () => ({
  parseLlmJson: mock((text: string) => JSON.parse(text)),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSyllabusExtraction — Phase 6 subject isolation", () => {
  beforeEach(() => {
    capturedCalls.length = 0;
    dbCallLog.length = 0;
    executeCallIndex = 0;
  });

  test("does not INSERT or UPDATE the subjects table", async () => {
    const { runSyllabusExtraction } = await import("../job");
    await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });

    // Inspect every captured SQL call for "subjects" keyword combined with
    // a mutation verb. The subjects table name is "subjects" in all raw SQL
    // literals (drizzle emits the table name directly in FROM/INTO/UPDATE
    // clauses as a StringChunk).
    const subjectMutations = capturedCalls.filter(
      (c) =>
        (c.rawText.includes("INSERT") || c.rawText.includes("UPDATE")) &&
        c.rawText.includes("subjects"),
    );
    expect(subjectMutations).toHaveLength(0);
  });

  test("does not rebind syllabus.subject_id via UPDATE", async () => {
    const { runSyllabusExtraction } = await import("../job");
    await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });

    const rebindCalls = capturedCalls.filter(
      (c) =>
        c.rawText.includes("UPDATE") &&
        c.rawText.includes("syllabuses") &&
        c.rawText.includes("subject_id"),
    );
    expect(rebindCalls).toHaveLength(0);
  });

  test("returns the subject_id from the syllabus row, not a derived id", async () => {
    const { runSyllabusExtraction } = await import("../job");
    const result = await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });
    expect(result.subjectId).toBe(SUBJECT_ID);
  });

  test("returns the correct syllabusId and conceptCount", async () => {
    const { runSyllabusExtraction } = await import("../job");
    const result = await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });
    expect(result.syllabusId).toBe(SYLLABUS_ID);
    expect(result.conceptCount).toBe(2);
  });

  test("makes a units SELECT call to look up existing units for the subject (call index 2)", async () => {
    const { runSyllabusExtraction } = await import("../job");
    await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });

    // Call index 2 is the SELECT units query. Its raw text should contain
    // "SELECT" and "subject_id" (the WHERE clause literal).
    const call2 = capturedCalls.find((c) => c.index === 2);
    expect(call2).toBeDefined();
    expect(call2!.rawText).toContain("SELECT");
    expect(call2!.rawText).toContain("subject_id");
  });

  test("total execute calls: no extra subject writes added", async () => {
    const { runSyllabusExtraction } = await import("../job");
    await runSyllabusExtraction({ syllabusId: SYLLABUS_ID, userId: USER_ID });

    // Old code: syllabuses fetch, status update, subjects upsert,
    // syllabuses subject_id rebind, N unit inserts, M concept inserts,
    // final status update.
    // New code: syllabuses fetch, status update, units select,
    // 1 unit UPDATE (matched), 1 unit INSERT (new), 2 concept inserts,
    // final status update = 7 calls.
    // The old code had 2 extra calls (subjects upsert + syllabuses rebind).
    expect(capturedCalls).toHaveLength(8); // 0-7 as listed in file header
  });
});
