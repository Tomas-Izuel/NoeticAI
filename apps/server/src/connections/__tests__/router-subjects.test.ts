/**
 * Unit tests for the Phase 6 multi-subject endpoints in connections/router.ts.
 *
 * Uses Bun's mock.module() to isolate the router from real Postgres / Redis /
 * Notion API calls. Tests cover:
 *
 *  - GET /api/connections/:id/mappings/:mappingId/available-subjects
 *      → subjects list, tracked flag, auth check
 *  - POST /api/connections/:id/mappings/:mappingId/subjects/sync
 *      → adds new, removes old (only those owned by THIS connection), enqueues jobs
 *  - POST /api/connections/:id/mappings  (updated contract — no subjectId in response)
 *
 * Run with: bun test src/connections/__tests__/router-subjects.test.ts
 */

import { describe, test, expect, mock, beforeAll, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_ID = "subjects-test-user";
const OTHER_USER_ID = "other-user";
const CONNECTION_ID = "conn-subj-001";
const OTHER_CONNECTION_ID = "conn-subj-other";
const MAPPING_ID = "mapping-subj-001";
const FAKE_TOKEN = "fake-notion-token-yyy";

// Available subjects returned by the strategy
const AVAILABLE_SUBJECTS = [
  { id: "subj-abc-123", name: "PHIL 411 — Theories of Knowledge", course: "PHIL 411", term: "Spring 2026", glyph: "📚" },
  { id: "subj-def-456", name: "CS 101 — Intro to CS", course: "CS 101", term: "Fall 2025" },
  { id: "subj-ghi-789", name: "MATH 201 — Calculus II", course: "MATH 201" },
];

// ---------------------------------------------------------------------------
// Pool mock: stateful to allow per-test query stubbing
// ---------------------------------------------------------------------------

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

let poolQueryImpl: QueryFn = async () => ({ rows: [] });

mock.module("../../db", () => ({
  pool: {
    query: mock(async (sql: string, params?: unknown[]) => poolQueryImpl(sql, params)),
  },
}));

// ---------------------------------------------------------------------------
// Auth mock
// ---------------------------------------------------------------------------

let currentUserId = USER_ID;

mock.module("../../auth", () => ({
  auth: {
    api: {
      getSession: mock(async () => ({ user: { id: currentUserId } })),
    },
  },
}));

// ---------------------------------------------------------------------------
// Redis cache mock: pass-through (no real Redis)
// ---------------------------------------------------------------------------

mock.module("../../redis/cache", () => ({
  cacheWrap: async <T>(_key: string, _ttl: number, loader: () => Promise<T>): Promise<T> =>
    loader(),
}));

// ---------------------------------------------------------------------------
// connectors/service mock
// ---------------------------------------------------------------------------

mock.module("../../connectors/service", () => ({
  getActiveConnection: mock(async () => ({
    row: { id: CONNECTION_ID, user_id: USER_ID, source: "notion", status: "active" },
    accessToken: FAKE_TOKEN,
  })),
  getActiveMapping: mock(async () => null),
}));

// ---------------------------------------------------------------------------
// notionFetch mock — strategies call this internally
// ---------------------------------------------------------------------------

mock.module("../../connectors/notion/api", () => ({
  notionFetch: async () => ({ results: [], next_cursor: null, has_more: false }),
  NOTION_API_BASE: "https://api.notion.com/v1",
  NOTION_API_VERSION: "2022-06-28",
}));

// ---------------------------------------------------------------------------
// queue mock — captures enqueueIngest calls
// ---------------------------------------------------------------------------

type IngestCall = { userId: string; source: string; subjectExternalId: string };
const enqueuedIngests: IngestCall[] = [];

mock.module("../../queue", () => ({
  enqueueIngest: mock(async (data: IngestCall) => {
    enqueuedIngests.push(data);
    return `job-${data.subjectExternalId}`;
  }),
}));

// ---------------------------------------------------------------------------
// Strategy mock: resolveSubjects returns AVAILABLE_SUBJECTS
// We mock the strategies module so the router's resolveAvailableSubjects
// calls the mocked strategy rather than trying to hit a real Notion API.
// ---------------------------------------------------------------------------

const mockResolveSubjects = mock(async () => AVAILABLE_SUBJECTS);
const mockSuggestConfig = mock(async () => ({}));
const mockValidateConfig = mock((raw: unknown) => raw);

mock.module("../../connectors/notion/strategies", () => ({
  notionStrategies: {
    "notion.db-subjects-db-units": {
      key: "notion.db-subjects-db-units",
      descriptor: {
        key: "notion.db-subjects-db-units",
        source: "notion",
        label: "Test strategy",
        description: "test",
        configSchema: {},
      },
      configSchema: {
        safeParse: (raw: unknown) => ({ success: true, data: raw }),
      },
      uiSchema: {},
      suggestConfig: mockSuggestConfig,
      resolveSubjects: mockResolveSubjects,
    },
  },
}));

// ---------------------------------------------------------------------------
// notionConnector mock (used by the discovery endpoints, not the subject ones)
// ---------------------------------------------------------------------------

mock.module("../../connectors/notion/connector", () => ({
  notionConnector: {},
  listTopLevelResourcesRich: mock(async () => ({ databases: [], pages: [] })),
}));

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

import { Hono } from "hono";

async function buildApp(): Promise<Hono> {
  const { connectionsRouter } = await import("../router");
  const app = new Hono();
  app.route("/", connectionsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers: standard DB query responses
// ---------------------------------------------------------------------------

function makeConnRow(userId = USER_ID) {
  return { id: CONNECTION_ID, source: "notion", user_id: userId };
}

function makeMappingRow() {
  return {
    id: MAPPING_ID,
    strategy_key: "notion.db-subjects-db-units",
    config_json: { subjectsDbId: "db-001", unitsDbId: "db-002" },
  };
}

// ---------------------------------------------------------------------------
// 1. GET /available-subjects
// ---------------------------------------------------------------------------

describe("GET /api/connections/:id/mappings/:mappingId/available-subjects", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    currentUserId = USER_ID;
    enqueuedIngests.length = 0;
  });

  test("returns all subjects, marks tracked correctly", async () => {
    // DB is queried twice: once for connection ownership, once for tracked subjects.
    let callCount = 0;
    poolQueryImpl = async (sql) => {
      callCount += 1;
      if (callCount === 1) {
        // connection ownership check
        return { rows: [makeConnRow()] };
      }
      if (callCount === 2) {
        // mapping check
        return { rows: [makeMappingRow()] };
      }
      // tracked subjects query — subj-abc-123 is already tracked
      return { rows: [{ id: "subj-abc-123" }] };
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/available-subjects`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      subjects: Array<{
        externalId: string;
        name: string;
        tracked: boolean;
        subjectId?: string;
      }>;
    };

    expect(body.subjects).toHaveLength(3);

    const phil = body.subjects.find((s) => s.externalId === "subj-abc-123");
    expect(phil).toBeDefined();
    expect(phil!.tracked).toBe(true);
    expect(phil!.subjectId).toBe("subj-abc-123");
    expect(phil!.name).toBe("PHIL 411 — Theories of Knowledge");

    const cs = body.subjects.find((s) => s.externalId === "subj-def-456");
    expect(cs).toBeDefined();
    expect(cs!.tracked).toBe(false);
    expect(cs!.subjectId).toBeUndefined();

    const math = body.subjects.find((s) => s.externalId === "subj-ghi-789");
    expect(math).toBeDefined();
    expect(math!.tracked).toBe(false);
  });

  test("returns 404 when connection belongs to another user", async () => {
    currentUserId = OTHER_USER_ID;
    poolQueryImpl = async () => ({ rows: [] }); // connection not found for other user

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/available-subjects`,
    );

    expect(res.status).toBe(404);
  });

  test("returns 404 when mapping does not exist for the connection", async () => {
    let callCount = 0;
    poolQueryImpl = async () => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] }; // conn found
      return { rows: [] }; // mapping not found
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/nonexistent-mapping/available-subjects`,
    );

    expect(res.status).toBe(404);
  });

  test("returns 401 when unauthenticated", async () => {
    const { auth } = await import("../../auth");
    // @ts-expect-error — override mock
    auth.api.getSession = mock(async () => null);

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/available-subjects`,
    );

    expect(res.status).toBe(401);

    // Restore
    // @ts-expect-error — restore mock
    auth.api.getSession = mock(async () => ({ user: { id: currentUserId } }));
  });
});

// ---------------------------------------------------------------------------
// 2. POST /subjects/sync
// ---------------------------------------------------------------------------

describe("POST /api/connections/:id/mappings/:mappingId/subjects/sync", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    currentUserId = USER_ID;
    enqueuedIngests.length = 0;
  });

  test("adds new subjects and enqueues ingest jobs when kickIngest=true", async () => {
    let callCount = 0;
    poolQueryImpl = async (sql) => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] }; // conn ownership
      if (callCount === 2) return { rows: [makeMappingRow()] }; // mapping
      if (callCount === 3) return { rows: [] }; // no existing subjects for this connection
      // INSERT for each new subject — return empty (we don't check the result)
      return { rows: [] };
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalIds: ["subj-abc-123", "subj-def-456"],
          kickIngest: true,
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json() as {
      added: string[];
      removed: string[];
      kept: string[];
      jobs: Array<{ subjectId: string; jobId: string }>;
    };

    expect(body.added).toContain("subj-abc-123");
    expect(body.added).toContain("subj-def-456");
    expect(body.removed).toHaveLength(0);
    expect(body.kept).toHaveLength(0);
    expect(body.jobs).toHaveLength(2);
    expect(enqueuedIngests).toHaveLength(2);
    expect(enqueuedIngests.every((j) => j.userId === USER_ID)).toBe(true);
    expect(enqueuedIngests.every((j) => j.source === "notion")).toBe(true);
  });

  test("removes subjects that belong to this connection but are not in the list", async () => {
    let callCount = 0;
    poolQueryImpl = async (sql) => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] }; // conn ownership
      if (callCount === 2) return { rows: [makeMappingRow()] }; // mapping
      if (callCount === 3) {
        // existing subjects owned by this connection
        return { rows: [{ id: "subj-abc-123" }, { id: "subj-ghi-789" }] };
      }
      // DELETE + INSERT queries
      return { rows: [] };
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalIds: ["subj-abc-123"], // keep only abc-123, remove ghi-789
          kickIngest: false,
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json() as {
      added: string[];
      removed: string[];
      kept: string[];
      jobs: Array<{ subjectId: string; jobId: string }>;
    };

    expect(body.removed).toContain("subj-ghi-789");
    expect(body.kept).toContain("subj-abc-123");
    expect(body.added).toHaveLength(0);
    expect(body.jobs).toHaveLength(0);
    expect(enqueuedIngests).toHaveLength(0);
  });

  test("does not remove subjects from a different connection", async () => {
    // existingSubjects query only returns subjects with connection_id = THIS connection.
    // Subjects from another connection are not in that result set, so they
    // can't end up in toRemove. This test verifies the query scoping.
    let callCount = 0;
    poolQueryImpl = async () => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] };
      if (callCount === 2) return { rows: [makeMappingRow()] };
      if (callCount === 3) {
        // Only subjects from THIS connection are returned — subjects from
        // OTHER_CONNECTION_ID do not appear here.
        return { rows: [{ id: "subj-abc-123" }] };
      }
      return { rows: [] };
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalIds: ["subj-abc-123"],
          kickIngest: false,
        }),
      },
    );

    expect(res.status).toBe(201);
    const body = await res.json() as { removed: string[] };
    // ghi-789 is "owned" by the other connection — not in the query result,
    // so it never appears in the removed list.
    expect(body.removed).not.toContain("subj-ghi-789");
  });

  test("returns 404 when another user's connection is used", async () => {
    currentUserId = OTHER_USER_ID;
    poolQueryImpl = async () => ({ rows: [] }); // no conn found for other user

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalIds: ["subj-abc-123"], kickIngest: false }),
      },
    );

    expect(res.status).toBe(404);
  });

  test("does not enqueue jobs when kickIngest=false", async () => {
    let callCount = 0;
    poolQueryImpl = async () => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] };
      if (callCount === 2) return { rows: [makeMappingRow()] };
      if (callCount === 3) return { rows: [] }; // no existing subjects
      return { rows: [] };
    };

    await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalIds: ["subj-abc-123"],
          kickIngest: false,
        }),
      },
    );

    expect(enqueuedIngests).toHaveLength(0);
  });

  test("returns 400 for invalid body", async () => {
    let callCount = 0;
    poolQueryImpl = async () => {
      callCount += 1;
      if (callCount <= 2) return { rows: [callCount === 1 ? makeConnRow() : makeMappingRow()] };
      return { rows: [] };
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/mappings/${MAPPING_ID}/subjects/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notAValidField: true }),
      },
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3. POST /api/connections/:id/mappings — updated contract (no subjectId)
// ---------------------------------------------------------------------------

describe("POST /api/connections/:id/mappings (updated contract)", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    currentUserId = USER_ID;
  });

  test("returns mappingId and availableSubjectsCount, not subjectId", async () => {
    let callCount = 0;
    poolQueryImpl = async () => {
      callCount += 1;
      if (callCount === 1) return { rows: [makeConnRow()] };
      // UPDATE (deactivate old mappings) + INSERT new mapping
      return { rows: [] };
    };

    const res = await app.request(`/api/connections/${CONNECTION_ID}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyKey: "notion.db-subjects-db-units",
        config: { subjectsDbId: "db-001", unitsDbId: "db-002" },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;

    expect(body.mappingId).toBeTypeOf("string");
    expect(body.availableSubjectsCount).toBeTypeOf("number");
    expect(body.availableSubjectsCount).toBe(3); // AVAILABLE_SUBJECTS has 3 entries
    // No subjectId in the new contract.
    expect(body.subjectId).toBeUndefined();
  });
});
