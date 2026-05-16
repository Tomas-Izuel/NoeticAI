/**
 * Unit tests for the Phase 6 wizard discovery endpoints in connections/router.ts.
 *
 * Uses Bun's mock.module() to isolate the router from real Postgres / Redis /
 * Notion API calls. Tests cover:
 *
 *  - GET /api/connections/:id/strategies/:key/discovery
 *      → { databases, pages, suggestedConfig }
 *  - GET /api/connections/:id/databases/:dbId/schema
 *      → { properties: PropertyDescriptor[] }  (insertion order preserved)
 *  - GET /api/connections/:id/databases/:dbId/properties/:propName/options
 *      → { options: [...] }  (select / status / empty for non-selectable prop)
 *
 * Run with: bun test src/connections/__tests__/router-discovery.test.ts
 */

import { describe, test, expect, mock, beforeAll } from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — must be declared BEFORE importing the modules under test.
// Bun hoists mock.module() calls, so the order in the file still works.
// ---------------------------------------------------------------------------

const FIXTURE_USER_ID = "discovery-test-user";
const CONNECTION_ID = "conn-disc-001";
const DB_ID = "db-disc-001";
const PAGE_ID = "page-disc-001";

// Fake Notion access token — never touches the real API.
const FAKE_TOKEN = "fake-notion-token-xxx";

// Pool stub: always returns the fixture connection row.
mock.module("../../db", () => ({
  pool: {
    query: mock(async () => ({
      rows: [{ id: CONNECTION_ID, source: "notion" }],
    })),
  },
}));

// Auth stub: always returns the fixture session.
mock.module("../../auth", () => ({
  auth: {
    api: {
      getSession: mock(async () => ({ user: { id: FIXTURE_USER_ID } })),
    },
  },
}));

// Redis cache stub: pass-through to the loader (no actual Redis calls).
mock.module("../../redis/cache", () => ({
  cacheWrap: async <T>(_key: string, _ttl: number, loader: () => Promise<T>): Promise<T> =>
    loader(),
}));

// connectors/service stub: always returns a fake active connection.
mock.module("../../connectors/service", () => ({
  getActiveConnection: mock(async () => ({
    row: { id: CONNECTION_ID, user_id: FIXTURE_USER_ID, source: "notion", status: "active" },
    accessToken: FAKE_TOKEN,
  })),
  getActiveMapping: mock(async () => null),
}));

// ---------------------------------------------------------------------------
// notionFetch stub — intercepts Notion API calls per endpoint under test.
// We install the dispatcher before each describe block.
// ---------------------------------------------------------------------------

type NotionFetchImpl = (token: string, path: string, init?: RequestInit) => Promise<unknown>;

let notionFetchImpl: NotionFetchImpl = async (_token, path) => {
  throw new Error(`notionFetch called with unmapped path: ${path}`);
};

mock.module("../../connectors/notion/api", () => ({
  notionFetch: async (token: string, path: string, init?: RequestInit) =>
    notionFetchImpl(token, path, init),
  NOTION_API_BASE: "https://api.notion.com/v1",
  NOTION_API_VERSION: "2022-06-28",
}));

// ---------------------------------------------------------------------------
// Import the router AFTER all mocks are registered.
// ---------------------------------------------------------------------------
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Fixture Notion API responses
// ---------------------------------------------------------------------------

function makeSearchDatabasesResponse() {
  return {
    results: [
      {
        id: DB_ID,
        object: "database",
        title: [{ plain_text: "Subjects" }],
        icon: { type: "emoji", emoji: "📚" },
      },
    ],
    next_cursor: null,
    has_more: false,
  };
}

function makeSearchPagesResponse() {
  return {
    results: [
      {
        id: PAGE_ID,
        object: "page",
        properties: {
          Name: { type: "title", title: [{ plain_text: "My Notes Root" }] },
        },
        icon: { type: "external", external: { url: "https://example.com/icon.png" } },
      },
    ],
    next_cursor: null,
    has_more: false,
  };
}

function makeDatabaseSchemaResponse() {
  // Properties returned in insertion order (JS object key order).
  return {
    id: DB_ID,
    properties: {
      Name: { type: "title" },
      Type: { type: "select" },
      Parent: { type: "relation" },
      "Last edited": { type: "last_edited_time" },
    },
  };
}

function makeSelectOptionsResponse() {
  return {
    id: DB_ID,
    properties: {
      Type: {
        type: "select",
        select: {
          options: [
            { name: "Subject", color: "blue" },
            { name: "Unit", color: "green" },
            { name: "Note", color: "yellow" },
          ],
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: build a fresh Hono app with the connections router.
// We import lazily inside tests so the mock.module calls above are applied.
// ---------------------------------------------------------------------------

async function buildApp(): Promise<Hono> {
  const { connectionsRouter } = await import("../router");
  const app = new Hono();
  app.route("/", connectionsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// 1. Discovery endpoint
// ---------------------------------------------------------------------------

describe("GET /api/connections/:id/strategies/:key/discovery", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  test("returns databases, pages, and suggestedConfig with rich fields", async () => {
    notionFetchImpl = async (_token, path, init) => {
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {};
      const filterKind = (body["filter"] as Record<string, string> | undefined)?.value;

      if (path === "/search" && filterKind === "database") {
        return makeSearchDatabasesResponse();
      }
      if (path === "/search" && filterKind === "page") {
        return makeSearchPagesResponse();
      }
      // DB row count probe (single-db-tagged suggestConfig with multiple DBs).
      if (path.includes("/query")) {
        return { results: [], next_cursor: null, has_more: false };
      }
      throw new Error(`[discovery] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/strategies/notion.single-db-tagged/discovery`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      databases: Array<{ id: string; title: string; icon: unknown }>;
      pages: Array<{ id: string; title: string; icon: unknown }>;
      suggestedConfig: Record<string, string>;
    };

    // Databases list with title and icon.
    expect(body.databases).toHaveLength(1);
    expect(body.databases[0]!.id).toBe(DB_ID);
    expect(body.databases[0]!.title).toBe("Subjects");
    expect(body.databases[0]!.icon).toMatchObject({ kind: "emoji", value: "📚" });

    // Pages list with title extracted from properties.
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]!.id).toBe(PAGE_ID);
    expect(body.pages[0]!.title).toBe("My Notes Root");
    expect(body.pages[0]!.icon).toMatchObject({
      kind: "url",
      value: "https://example.com/icon.png",
    });

    // suggestedConfig — single-db-tagged with one DB → databaseId set.
    expect(body.suggestedConfig.databaseId).toBe(DB_ID);
  });

  test("page-hierarchy suggestConfig pre-fills rootPageId from pages list", async () => {
    notionFetchImpl = async (_token, path, init) => {
      const body = init?.body
        ? (JSON.parse(init.body as string) as Record<string, unknown>)
        : {};
      const filterKind = (body["filter"] as Record<string, string> | undefined)?.value;
      if (path === "/search" && filterKind === "database") {
        return { results: [], next_cursor: null, has_more: false };
      }
      if (path === "/search" && filterKind === "page") {
        return makeSearchPagesResponse();
      }
      throw new Error(`[discovery/page-hierarchy] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/strategies/notion.page-hierarchy/discovery`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { suggestedConfig: Record<string, unknown> };
    expect(body.suggestedConfig.rootPageId).toBe(PAGE_ID);
    expect(body.suggestedConfig.depth).toBe(3);
  });

  test("returns 404 for unknown strategy key", async () => {
    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/strategies/notion.does-not-exist/discovery`,
    );
    expect(res.status).toBe(404);
  });

  test("returns 404 when pool returns no connection row (not owned)", async () => {
    const { pool } = await import("../../db");
    // @ts-expect-error — mock method on the stub
    pool.query = mock(async () => ({ rows: [] }));

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/strategies/notion.single-db-tagged/discovery`,
    );
    expect(res.status).toBe(404);

    // Restore.
    // @ts-expect-error — restore mock
    pool.query = mock(async () => ({ rows: [{ id: CONNECTION_ID, source: "notion" }] }));
  });
});

// ---------------------------------------------------------------------------
// 2. Schema endpoint
// ---------------------------------------------------------------------------

describe("GET /api/connections/:id/databases/:dbId/schema", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  test("returns PropertyDescriptor[] in insertion order", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) return makeDatabaseSchemaResponse();
      throw new Error(`[schema] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/schema`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      properties: Array<{ name: string; type: string }>;
    };

    expect(body.properties).toHaveLength(4);
    // Insertion order must be preserved.
    expect(body.properties[0]).toMatchObject({ name: "Name", type: "title" });
    expect(body.properties[1]).toMatchObject({ name: "Type", type: "select" });
    expect(body.properties[2]).toMatchObject({ name: "Parent", type: "relation" });
    expect(body.properties[3]).toMatchObject({ name: "Last edited", type: "last_edited_time" });
  });

  test("property types are exposed correctly", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) return makeDatabaseSchemaResponse();
      throw new Error(`[schema/types] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/schema`,
    );
    const body = await res.json() as { properties: Array<{ name: string; type: string }> };
    const byName: Record<string, string> = {};
    for (const p of body.properties) {
      byName[p.name] = p.type;
    }
    expect(byName["Name"]).toBe("title");
    expect(byName["Type"]).toBe("select");
    expect(byName["Parent"]).toBe("relation");
  });
});

// ---------------------------------------------------------------------------
// 3. Options endpoint
// ---------------------------------------------------------------------------

describe("GET /api/connections/:id/databases/:dbId/properties/:propName/options", () => {
  let app: Hono;

  beforeAll(async () => {
    app = await buildApp();
  });

  test("returns select options with value=label=option name, color preserved", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) return makeSelectOptionsResponse();
      throw new Error(`[options/select] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/properties/Type/options`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      options: Array<{ value: string; label: string; color?: string }>;
    };

    expect(body.options).toHaveLength(3);
    expect(body.options[0]).toMatchObject({ value: "Subject", label: "Subject", color: "blue" });
    expect(body.options[1]).toMatchObject({ value: "Unit", label: "Unit", color: "green" });
    expect(body.options[2]).toMatchObject({ value: "Note", label: "Note", color: "yellow" });
  });

  test("returns status options correctly", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) {
        return {
          id: DB_ID,
          properties: {
            Status: {
              type: "status",
              status: {
                options: [
                  { name: "Not started", color: "gray" },
                  { name: "In progress", color: "blue" },
                  { name: "Done", color: "green" },
                ],
              },
            },
          },
        };
      }
      throw new Error(`[options/status] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/properties/Status/options`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { options: Array<{ value: string; label: string }> };
    expect(body.options).toHaveLength(3);
    expect(body.options[0]!.value).toBe("Not started");
    expect(body.options[0]!.label).toBe("Not started");
  });

  test("returns empty options for a non-selectable property (title)", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) {
        return {
          id: DB_ID,
          properties: {
            Name: { type: "title" },
          },
        };
      }
      throw new Error(`[options/title] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/properties/Name/options`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { options: unknown[] };
    expect(body.options).toHaveLength(0);
  });

  test("returns empty options when property name does not exist in the DB", async () => {
    notionFetchImpl = async (_token, path) => {
      if (path === `/databases/${DB_ID}`) {
        return { id: DB_ID, properties: { Name: { type: "title" } } };
      }
      throw new Error(`[options/missing-prop] Unmapped: ${path}`);
    };

    const res = await app.request(
      `/api/connections/${CONNECTION_ID}/databases/${DB_ID}/properties/NonExistent/options`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { options: unknown[] };
    expect(body.options).toHaveLength(0);
  });
});
