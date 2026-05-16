/**
 * Integration tests for POST /api/syllabus (Phase 6 syllabus-fix).
 *
 * Covers:
 *   1. 400 when subjectId is missing from the form.
 *   2. 404 when the provided subjectId does not exist.
 *   3. 403 when the subjectId belongs to a different user.
 *   4. 201 when the subject is valid and owned by the caller.
 *
 * All Postgres / storage / queue calls are mocked so no real DB is needed.
 *
 * Run with: bun test src/syllabus/__tests__/router.test.ts
 */

import { describe, test, expect, mock, beforeAll } from "bun:test";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Auth mock — controlled per test via currentUserId
// ---------------------------------------------------------------------------

let currentUserId = "user-a";

mock.module("../../auth", () => ({
  auth: {
    api: {
      getSession: mock(async () => ({ user: { id: currentUserId } })),
    },
  },
}));

// ---------------------------------------------------------------------------
// DB mock — drive subject lookup responses per test
// ---------------------------------------------------------------------------

// The router does two queries: SELECT subject, then SELECT MAX(version).
// We cycle through these responses in order for each test.
type DbRow = Record<string, unknown>;

let dbResponses: Array<{ rows: DbRow[] }> = [];
let dbCallIndex = 0;

mock.module("../../db", () => ({
  db: {
    execute: mock(async () => {
      const resp = dbResponses[dbCallIndex] ?? { rows: [] };
      dbCallIndex += 1;
      return resp;
    }),
  },
  pool: { query: mock(async () => ({ rows: [] })) },
}));

// ---------------------------------------------------------------------------
// Storage mock — always succeeds
// ---------------------------------------------------------------------------

mock.module("../storage", () => ({
  storeSyllabusPdf: mock(async () => ({
    relativePath: "uploads/syllabuses/test.pdf",
    filename: "test.pdf",
  })),
}));

// ---------------------------------------------------------------------------
// Queue mock — always succeeds
// ---------------------------------------------------------------------------

mock.module("../../queue", () => ({
  enqueueSyllabusExtraction: mock(async () => "job-test-001"),
}));

// ---------------------------------------------------------------------------
// App builder — imported after mocks are registered
// ---------------------------------------------------------------------------

async function buildApp(): Promise<Hono> {
  const { syllabusRouter } = await import("../router");
  const app = new Hono();
  app.route("/", syllabusRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: build a multipart POST /api/syllabus request
// ---------------------------------------------------------------------------

function makePdfFile(name = "syllabus.pdf"): File {
  // Minimal valid-looking bytes (just enough to pass type check).
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  return new File([bytes], name, { type: "application/pdf" });
}

async function postSyllabus(
  app: Hono,
  fields: { subjectId?: string } = {},
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", makePdfFile());
  if (fields.subjectId !== undefined) {
    fd.append("subjectId", fields.subjectId);
  }

  return app.fetch(
    new Request("http://localhost/api/syllabus", {
      method: "POST",
      body: fd,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let app: Hono;

beforeAll(async () => {
  app = await buildApp();
});

describe("POST /api/syllabus — Phase 6 subjectId validation", () => {
  test("400 when subjectId field is missing", async () => {
    dbCallIndex = 0;
    dbResponses = [];

    // No subjectId field at all
    const res = await postSyllabus(app, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("subjectId is required");
  });

  test("400 when subjectId is an empty string", async () => {
    dbCallIndex = 0;
    dbResponses = [];

    const fd = new FormData();
    fd.append("file", makePdfFile());
    fd.append("subjectId", "   "); // whitespace only

    const res = await app.fetch(
      new Request("http://localhost/api/syllabus", {
        method: "POST",
        body: fd,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("subjectId is required");
  });

  test("404 when subjectId does not exist in subjects table", async () => {
    currentUserId = "user-a";
    dbCallIndex = 0;
    // Empty rows = subject not found
    dbResponses = [{ rows: [] }];

    const res = await postSyllabus(app, { subjectId: "nonexistent-subject" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("subject not found");
  });

  test("403 when subjectId belongs to a different user", async () => {
    currentUserId = "user-a";
    dbCallIndex = 0;
    // Subject row owned by user-b
    dbResponses = [{ rows: [{ id: "subj-001", user_id: "user-b" }] }];

    const res = await postSyllabus(app, { subjectId: "subj-001" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });

  test("201 when subject exists and is owned by the caller", async () => {
    currentUserId = "user-a";
    dbCallIndex = 0;
    dbResponses = [
      // 1. Subject ownership check: found, owned by user-a
      { rows: [{ id: "subj-owned", user_id: "user-a" }] },
      // 2. MAX(version) query: no prior syllabus
      { rows: [{ max_version: null }] },
      // 3. INSERT INTO syllabuses
      { rows: [] },
    ];

    const res = await postSyllabus(app, { subjectId: "subj-owned" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { syllabusId: string; version: number; jobId: string };
    expect(typeof body.syllabusId).toBe("string");
    expect(body.version).toBe(1);
    expect(body.jobId).toBe("job-test-001");
  });
});
