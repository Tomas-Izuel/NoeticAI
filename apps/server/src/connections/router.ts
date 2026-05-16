import { Hono } from "hono";
import { z } from "zod";
import { auth } from "../auth";
import { pool } from "../db";
import { getActiveConnection, getActiveMapping } from "../connectors/service";
import { notionStrategies } from "../connectors/notion/strategies";
import {
  notionConnector,
  listTopLevelResourcesRich,
} from "../connectors/notion/connector";
import { notionFetch } from "../connectors/notion/api";
import { cacheWrap } from "../redis/cache";
import { enqueueIngest } from "../queue";
import type { PropertyDescriptor } from "../connectors/notion/strategies/types";
import type { Subject } from "@noeticai/connector-core";

export const connectionsRouter = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Returns an array of all known strategy descriptors for a given source.
function getStrategyDescriptors(source: string) {
  if (source === "notion") {
    return Object.values(notionStrategies).map((s) => s.descriptor);
  }
  return [];
}

// Validates config against the strategy's zod schema. Returns parsed data or
// throws a 400-compatible error.
function validateConfig(
  strategyKey: string,
  rawConfig: unknown,
): Record<string, unknown> {
  const strategy = notionStrategies[strategyKey];
  if (!strategy) throw Object.assign(new Error(`Unknown strategy: ${strategyKey}`), { httpStatus: 400 });
  const parsed = strategy.configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw Object.assign(new Error("Invalid config"), {
      httpStatus: 400,
      issues: parsed.error.issues,
    });
  }
  return parsed.data as Record<string, unknown>;
}

// Builds a bound NotionClient from an access token.
function buildNotionClient(accessToken: string) {
  return {
    fetch<T>(path: string, init?: RequestInit): Promise<T> {
      return notionFetch<T>(accessToken, path, init);
    },
  };
}

// Resolves available subjects for a mapping using cacheWrap (30s TTL).
// Cache key: notion:availableSubjects:<mappingId>
async function resolveAvailableSubjects(
  mappingId: string,
  strategyKey: string,
  config: Record<string, unknown>,
  accessToken: string,
): Promise<Subject[]> {
  const strategy = notionStrategies[strategyKey];
  if (!strategy) return [];
  const notionClient = buildNotionClient(accessToken);
  return cacheWrap<Subject[]>(
    `notion:availableSubjects:${mappingId}`,
    30,
    () =>
      strategy.resolveSubjects({
        config: config as Parameters<typeof strategy.resolveSubjects>[0]["config"],
        notionClient,
      }),
  );
}

// ---------------------------------------------------------------------------
// GET /api/connections
// ---------------------------------------------------------------------------

connectionsRouter.get("/api/connections", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const rows = await pool.query<{
    id: string;
    source: string;
    workspace_name: string;
    workspace_icon: string | null;
    status: string;
    created_at: Date;
  }>(
    `SELECT id, source, workspace_name, workspace_icon, status, created_at
     FROM source_connections
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [session.user.id],
  );

  return c.json({
    connections: rows.rows.map((r) => ({
      id: r.id,
      source: r.source,
      workspaceName: r.workspace_name,
      workspaceIcon: r.workspace_icon,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/connections/:id/disconnect
// Soft-delete: sets status = 'revoked'. Hard-deletes structure_mappings.
// ---------------------------------------------------------------------------

connectionsRouter.post("/api/connections/:id/disconnect", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");

  // Ownership check.
  const ownerRows = await pool.query<{ id: string }>(
    `SELECT id FROM source_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, session.user.id],
  );
  if (!ownerRows.rows[0]) return c.json({ error: "connection not found or forbidden" }, 404);

  // Revoke the connection.
  await pool.query(
    `UPDATE source_connections SET status = 'revoked', updated_at = NOW() WHERE id = $1`,
    [connectionId],
  );

  // Hard-delete mappings (per plan §5.1 — ingested data is preserved separately).
  await pool.query(`DELETE FROM structure_mappings WHERE connection_id = $1`, [connectionId]);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/strategies
// Returns StrategyDescriptor[] for the connection's source.
// descriptor.configSchema is the SerializedConfigSchema for wizard rendering.
// ---------------------------------------------------------------------------

connectionsRouter.get("/api/connections/:id/strategies", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");

  const rows = await pool.query<{ id: string; source: string }>(
    `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, session.user.id],
  );
  const conn = rows.rows[0];
  if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

  const descriptors = getStrategyDescriptors(conn.source);
  return c.json({ strategies: descriptors });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/strategies/:key/discovery
// Returns rich top-level resources (databases + pages with titles/icons)
// and the strategy's config suggestion.
// ---------------------------------------------------------------------------

connectionsRouter.get("/api/connections/:id/strategies/:key/discovery", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");
  const strategyKey = c.req.param("key");

  // Ownership + source check.
  const rows = await pool.query<{ id: string; source: string }>(
    `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [connectionId, session.user.id],
  );
  const conn = rows.rows[0];
  if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

  const strategy = notionStrategies[strategyKey];
  if (!strategy || conn.source !== "notion") {
    return c.json({ error: "strategy not found for this connection" }, 404);
  }

  const activeConn = await getActiveConnection(session.user.id, conn.source);
  if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

  const notionClient = buildNotionClient(activeConn.accessToken);

  const { databases, pages } = await listTopLevelResourcesRich(
    connectionId,
    activeConn.accessToken,
  );

  const suggestedConfig = await strategy.suggestConfig({ databases, pages, notionClient });

  return c.json({ databases, pages, suggestedConfig });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/databases/:dbId/schema
// Returns PropertyDescriptor[] for a Notion database (insertion order preserved).
// Cached in Redis for 5 min.
// ---------------------------------------------------------------------------

connectionsRouter.get("/api/connections/:id/databases/:dbId/schema", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");
  const dbId = c.req.param("dbId");

  // Ownership check.
  const rows = await pool.query<{ id: string; source: string }>(
    `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [connectionId, session.user.id],
  );
  const conn = rows.rows[0];
  if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

  const activeConn = await getActiveConnection(session.user.id, conn.source);
  if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

  const properties = await cacheWrap<PropertyDescriptor[]>(
    `notion:dbSchema:${dbId}`,
    300, // 5 min TTL
    async () => {
      const db = await notionFetch<{
        properties: Record<string, { type: string }>;
      }>(activeConn.accessToken, `/databases/${dbId}`);

      // Preserve insertion order by iterating Object.entries.
      return Object.entries(db.properties).map(([name, prop]) => ({
        name,
        type: prop.type as PropertyDescriptor["type"],
      }));
    },
  );

  return c.json({ properties });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/databases/:dbId/properties/:propName/options
// Returns select/status/multi_select options for a property.
// Cached in Redis for 5 min.
// ---------------------------------------------------------------------------

connectionsRouter.get(
  "/api/connections/:id/databases/:dbId/properties/:propName/options",
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);

    const connectionId = c.req.param("id");
    const dbId = c.req.param("dbId");
    const propName = c.req.param("propName");

    // Ownership check.
    const rows = await pool.query<{ id: string; source: string }>(
      `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [connectionId, session.user.id],
    );
    const conn = rows.rows[0];
    if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

    const activeConn = await getActiveConnection(session.user.id, conn.source);
    if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

    type NotionOption = { name: string; color?: string };

    const options = await cacheWrap<{ value: string; label: string; color?: string }[]>(
      `notion:propOptions:${dbId}:${propName}`,
      300, // 5 min TTL
      async () => {
        const db = await notionFetch<{
          properties: Record<string, {
            type: string;
            select?: { options: NotionOption[] };
            status?: { options: NotionOption[] };
            multi_select?: { options: NotionOption[] };
          }>;
        }>(activeConn.accessToken, `/databases/${dbId}`);

        const prop = db.properties[propName];
        if (!prop) return [];

        let rawOptions: NotionOption[] = [];
        if (prop.type === "select" && prop.select) {
          rawOptions = prop.select.options;
        } else if (prop.type === "status" && prop.status) {
          rawOptions = prop.status.options;
        } else if (prop.type === "multi_select" && prop.multi_select) {
          rawOptions = prop.multi_select.options;
        }

        // Notion's API uses option names as the wire value for filtering.
        return rawOptions.map((opt) => ({
          value: opt.name,
          label: opt.name,
          ...(opt.color ? { color: opt.color } : {}),
        }));
      },
    );

    return c.json({ options });
  },
);

// ---------------------------------------------------------------------------
// POST /api/connections/:id/mappings
//
// Creates/updates an active structure mapping. No longer auto-creates subjects.
// Frontend callsite (connect/done.tsx step 2) must advance to a subject-picker
// step instead of going straight to ingest — the response no longer returns a
// subjectId.
//
// CONTRACT CHANGE (Phase 6 multi-subject): returns { mappingId,
// availableSubjectsCount } instead of { mappingId, subjectId }.
// ---------------------------------------------------------------------------

const CreateMappingBodySchema = z.object({
  strategyKey: z.string().min(1),
  config: z.record(z.unknown()),
});

connectionsRouter.post("/api/connections/:id/mappings", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");

  // Ownership + active status check.
  const rows = await pool.query<{ id: string; source: string }>(
    `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [connectionId, session.user.id],
  );
  const conn = rows.rows[0];
  if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = CreateMappingBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }

  let validatedConfig: Record<string, unknown>;
  try {
    validatedConfig = validateConfig(parsed.data.strategyKey, parsed.data.config);
  } catch (err) {
    const e = err as { message: string; httpStatus?: number; issues?: unknown[] };
    return c.json({ error: e.message, issues: e.issues }, (e.httpStatus as 400 | 404) ?? 400);
  }

  // Deactivate any existing active mappings for this connection so we don't
  // accumulate stale active rows (one active mapping per connection in v1).
  await pool.query(
    `UPDATE structure_mappings SET is_active = FALSE, updated_at = NOW()
     WHERE connection_id = $1 AND is_active = TRUE`,
    [connectionId],
  );

  const mappingId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO structure_mappings (id, connection_id, strategy_key, config_json, is_active)
     VALUES ($1, $2, $3, $4, TRUE)`,
    [mappingId, connectionId, parsed.data.strategyKey, JSON.stringify(validatedConfig)],
  );

  // Resolve and cache available subjects to warm the 30s cache for the
  // immediately-following GET /available-subjects call.
  const activeConn = await getActiveConnection(session.user.id, conn.source);
  if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

  let availableSubjectsCount = 0;
  try {
    const subjects = await resolveAvailableSubjects(
      mappingId,
      parsed.data.strategyKey,
      validatedConfig,
      activeConn.accessToken,
    );
    availableSubjectsCount = subjects.length;
  } catch (err) {
    // Non-fatal: mapping is created; subject resolution can be retried via
    // GET /available-subjects.
    // eslint-disable-next-line no-console
    console.warn("[connections/router] resolveSubjects failed after mapping creation:", err);
  }

  return c.json({ mappingId, availableSubjectsCount }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /api/connections/:id/mappings/:mappingId
// Partial config update with re-validation.
// ---------------------------------------------------------------------------

const PatchMappingBodySchema = z.object({
  config: z.record(z.unknown()),
});

connectionsRouter.patch("/api/connections/:id/mappings/:mappingId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");
  const mappingId = c.req.param("mappingId");

  // Verify ownership via connection.
  const ownerRows = await pool.query<{ id: string }>(
    `SELECT sc.id FROM source_connections sc
     WHERE sc.id = $1 AND sc.user_id = $2`,
    [connectionId, session.user.id],
  );
  if (!ownerRows.rows[0]) return c.json({ error: "connection not found or forbidden" }, 404);

  const mappingRows = await pool.query<{
    id: string;
    strategy_key: string;
    config_json: unknown;
  }>(
    `SELECT id, strategy_key, config_json FROM structure_mappings
     WHERE id = $1 AND connection_id = $2`,
    [mappingId, connectionId],
  );
  const mapping = mappingRows.rows[0];
  if (!mapping) return c.json({ error: "mapping not found" }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const parsed = PatchMappingBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }

  // Merge with existing config and re-validate the full config.
  const merged = { ...(mapping.config_json as Record<string, unknown>), ...parsed.data.config };

  let validatedConfig: Record<string, unknown>;
  try {
    validatedConfig = validateConfig(mapping.strategy_key, merged);
  } catch (err) {
    const e = err as { message: string; httpStatus?: number; issues?: unknown[] };
    return c.json({ error: e.message, issues: e.issues }, (e.httpStatus as 400 | 404) ?? 400);
  }

  await pool.query(
    `UPDATE structure_mappings SET config_json = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(validatedConfig), mappingId],
  );

  return c.json({ ok: true, mappingId });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/mappings/active
// Returns the current active mapping for a connection.
// ---------------------------------------------------------------------------

connectionsRouter.get("/api/connections/:id/mappings/active", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const connectionId = c.req.param("id");

  // Ownership check.
  const ownerRows = await pool.query<{ id: string }>(
    `SELECT id FROM source_connections WHERE id = $1 AND user_id = $2`,
    [connectionId, session.user.id],
  );
  if (!ownerRows.rows[0]) return c.json({ error: "connection not found or forbidden" }, 404);

  const mapping = await getActiveMapping(connectionId);
  if (!mapping) return c.json({ mapping: null });

  return c.json({
    mapping: {
      id: mapping.id,
      strategyKey: mapping.strategy_key,
      configJson: mapping.config_json,
      subjectId: mapping.subject_id,
      isActive: mapping.is_active,
      createdAt: mapping.created_at,
      updatedAt: mapping.updated_at,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/connections/:id/mappings/:mappingId/available-subjects
//
// Returns all subjects the strategy can see in the workspace, annotated with
// tracked: true if the subject already exists in the DB for this user.
//
// Response shape:
// {
//   subjects: Array<{
//     externalId: string;
//     name: string;
//     course?: string;
//     term?: string;
//     glyph?: string;
//     tracked: boolean;
//     subjectId?: string;   // present iff tracked === true
//   }>
// }
//
// Shared by the connect wizard (step 3) and the settings "Manage subjects"
// panel — no other endpoints needed.
// ---------------------------------------------------------------------------

connectionsRouter.get(
  "/api/connections/:id/mappings/:mappingId/available-subjects",
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);

    const connectionId = c.req.param("id");
    const mappingId = c.req.param("mappingId");

    // Ownership check: verify the connection belongs to this user.
    const connRows = await pool.query<{ id: string; source: string }>(
      `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [connectionId, session.user.id],
    );
    const conn = connRows.rows[0];
    if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

    // Verify the mapping belongs to this connection.
    const mappingRows = await pool.query<{
      id: string;
      strategy_key: string;
      config_json: unknown;
    }>(
      `SELECT id, strategy_key, config_json FROM structure_mappings
       WHERE id = $1 AND connection_id = $2`,
      [mappingId, connectionId],
    );
    const mapping = mappingRows.rows[0];
    if (!mapping) return c.json({ error: "mapping not found" }, 404);

    const activeConn = await getActiveConnection(session.user.id, conn.source);
    if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

    // Resolve subjects via the strategy (cached 30s).
    let available: Subject[] = [];
    try {
      available = await resolveAvailableSubjects(
        mappingId,
        mapping.strategy_key,
        mapping.config_json as Record<string, unknown>,
        activeConn.accessToken,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[connections/router] resolveSubjects failed in available-subjects:", err);
      return c.json({ error: "failed to resolve subjects from connector" }, 502);
    }

    if (available.length === 0) {
      return c.json({ subjects: [] });
    }

    // Join against the subjects table to mark tracked ones.
    // Subject ids mirror the external id (connector convention).
    const externalIds = available.map((s) => s.id);
    const trackedRows = await pool.query<{ id: string }>(
      `SELECT id FROM subjects WHERE user_id = $1 AND id = ANY($2::text[])`,
      [session.user.id, externalIds],
    );
    const trackedSet = new Set(trackedRows.rows.map((r) => r.id));

    const subjects = available.map((s) => ({
      externalId: s.id,
      name: s.name,
      ...(s.course ? { course: s.course } : {}),
      ...(s.term ? { term: s.term } : {}),
      ...(s.glyph ? { glyph: s.glyph } : {}),
      tracked: trackedSet.has(s.id),
      ...(trackedSet.has(s.id) ? { subjectId: s.id } : {}),
    }));

    return c.json({ subjects });
  },
);

// ---------------------------------------------------------------------------
// POST /api/connections/:id/mappings/:mappingId/subjects/sync
//
// Makes the tracked subject set equal to the provided externalIds list for
// this user + connection.
//
// Body: { externalIds: string[], kickIngest: boolean }
//
// - Inserts rows for externalIds not yet in subjects (hydrated from the
//   available-subjects cache, or a fresh resolveSubjects call).
// - Hard-deletes subjects that ARE in the DB with this connection_id but
//   NOT in the externalIds list (does not touch subjects from other
//   connections or the stub path).
// - If kickIngest === true, enqueues one ingest job per newly added subject.
//
// Response: { added, removed, kept, jobs: [{ subjectId, jobId }] }
// ---------------------------------------------------------------------------

const SubjectSyncBodySchema = z.object({
  externalIds: z.array(z.string().min(1)),
  kickIngest: z.boolean().default(false),
});

connectionsRouter.post(
  "/api/connections/:id/mappings/:mappingId/subjects/sync",
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthenticated" }, 401);

    const connectionId = c.req.param("id");
    const mappingId = c.req.param("mappingId");
    const userId = session.user.id;

    // Ownership check: connection belongs to this user.
    const connRows = await pool.query<{ id: string; source: string }>(
      `SELECT id, source FROM source_connections WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [connectionId, userId],
    );
    const conn = connRows.rows[0];
    if (!conn) return c.json({ error: "connection not found or forbidden" }, 404);

    // Mapping belongs to this connection.
    const mappingRows = await pool.query<{
      id: string;
      strategy_key: string;
      config_json: unknown;
    }>(
      `SELECT id, strategy_key, config_json FROM structure_mappings
       WHERE id = $1 AND connection_id = $2`,
      [mappingId, connectionId],
    );
    const mapping = mappingRows.rows[0];
    if (!mapping) return c.json({ error: "mapping not found" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }

    const parsed = SubjectSyncBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
    }

    const { externalIds, kickIngest } = parsed.data;
    const desiredSet = new Set(externalIds);

    // Fetch current subjects owned by this connection for this user.
    const existingRows = await pool.query<{ id: string }>(
      `SELECT id FROM subjects WHERE user_id = $1 AND connection_id = $2`,
      [userId, connectionId],
    );
    const existingSet = new Set(existingRows.rows.map((r) => r.id));

    // Compute diff.
    const toAdd = externalIds.filter((id) => !existingSet.has(id));
    const toRemove = [...existingSet].filter((id) => !desiredSet.has(id));
    const kept = externalIds.filter((id) => existingSet.has(id));

    // Hard-delete removed subjects (FKs cascade to all descendant tables).
    // Defense-in-depth: filter by user_id AND connection_id so we never
    // delete subjects owned by a different user or a different connection.
    if (toRemove.length > 0) {
      await pool.query(
        `DELETE FROM subjects WHERE id = ANY($1::text[]) AND user_id = $2 AND connection_id = $3`,
        [toRemove, userId, connectionId],
      );
    }

    // Resolve hydration data for new subjects from the available-subjects cache
    // (warm from the POST /mappings call or the prior GET /available-subjects).
    const activeConn = await getActiveConnection(userId, conn.source);
    if (!activeConn) return c.json({ error: "connection token unavailable" }, 503);

    let availableSubjects: Subject[] = [];
    try {
      availableSubjects = await resolveAvailableSubjects(
        mappingId,
        mapping.strategy_key,
        mapping.config_json as Record<string, unknown>,
        activeConn.accessToken,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[connections/router] resolveSubjects failed in subjects/sync:", err);
      return c.json({ error: "failed to resolve subjects from connector" }, 502);
    }

    const subjectIndex = new Map(availableSubjects.map((s) => [s.id, s]));

    // Insert new subjects.
    const addedIds: string[] = [];
    for (const externalId of toAdd) {
      const info = subjectIndex.get(externalId);
      if (!info) {
        // externalId is not in the workspace — skip rather than hard-failing the
        // entire sync so a partially-valid selection still works.
        // eslint-disable-next-line no-console
        console.warn(`[connections/router] subjects/sync: externalId ${externalId} not found in connector, skipping`);
        continue;
      }
      // Defense: ensure this user owns the insert (subjects.user_id === caller).
      await pool.query(
        `INSERT INTO subjects (id, user_id, connection_id, name, course, term, glyph, lang)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'es')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           course = EXCLUDED.course,
           term = EXCLUDED.term,
           glyph = EXCLUDED.glyph,
           connection_id = EXCLUDED.connection_id,
           updated_at = NOW()`,
        [
          externalId,
          userId,
          connectionId,
          info.name,
          info.course ?? null,
          info.term ?? null,
          info.glyph ?? null,
        ],
      );
      addedIds.push(externalId);
    }

    // Enqueue per-subject ingest jobs for newly added subjects.
    const jobs: Array<{ subjectId: string; jobId: string }> = [];
    if (kickIngest) {
      for (const subjectId of addedIds) {
        try {
          const jobId = await enqueueIngest({
            userId,
            source: conn.source,
            subjectExternalId: subjectId,
          });
          jobs.push({ subjectId, jobId });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[connections/router] subjects/sync: failed to enqueue ingest for subject=${subjectId}:`,
            err,
          );
        }
      }
    }

    return c.json(
      {
        added: addedIds,
        removed: toRemove,
        kept,
        jobs,
      },
      201,
    );
  },
);
