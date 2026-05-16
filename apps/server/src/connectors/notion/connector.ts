import type {
  Connector,
  Subject,
  Unit,
  NoteSummary,
  NoteContent,
  ResourceRef,
} from "@noeticai/connector-core";
import { notionFetch } from "./api";
import { notionStrategies } from "./strategies";
import type {
  NotionDatabaseRef,
  NotionPageRef,
  NotionTopResourcesRich,
  NotionIconRef,
} from "./strategies/types";
import { getActiveConnection, getActiveMapping } from "../service";
import { cacheWrap } from "../../redis/cache";

interface NotionSearchResult {
  id: string;
  object: string;
  // Title info lives in title array for databases
  title?: Array<{ plain_text: string }>;
  // Properties hold the title for pages
  properties?: Record<string, {
    type: string;
    title?: Array<{ plain_text: string }>;
  }>;
  icon?: {
    type: string;
    emoji?: string;
    external?: { url: string };
    file?: { url: string };
  } | null;
}

interface NotionSearchResponse {
  results: NotionSearchResult[];
  next_cursor: string | null;
  has_more: boolean;
}

// ---------------------------------------------------------------------------
// Icon extraction helper
// ---------------------------------------------------------------------------

function extractIcon(
  icon: NotionSearchResult["icon"],
): NotionIconRef | null {
  if (!icon) return null;
  if (icon.type === "emoji" && icon.emoji) return { kind: "emoji", value: icon.emoji };
  if (icon.type === "external" && icon.external?.url) return { kind: "url", value: icon.external.url };
  if (icon.type === "file" && icon.file?.url) return { kind: "url", value: icon.file.url };
  return null;
}

// ---------------------------------------------------------------------------
// Page title extraction from search results (pages have no top-level title)
// ---------------------------------------------------------------------------

function extractPageTitleFromSearchResult(item: NotionSearchResult): string {
  if (!item.properties) return "Untitled";
  for (const prop of Object.values(item.properties)) {
    if (prop.type === "title" && prop.title && prop.title.length > 0) {
      return prop.title.map((t) => t.plain_text).join("").trim() || "Untitled";
    }
  }
  return "Untitled";
}

// Creates a bound NotionClient for a given access token.
function buildClient(accessToken: string) {
  return {
    fetch<T>(path: string, init?: RequestInit): Promise<T> {
      return notionFetch<T>(accessToken, path, init);
    },
  };
}

// Resolves the active connection for a user and returns a bound client + connection id.
// Throws if no active connection exists.
async function resolveConnection(userId: string) {
  const conn = await getActiveConnection(userId, "notion");
  if (!conn) {
    throw new Error(`No active Notion connection for user ${userId}`);
  }
  return { connectionId: conn.row.id, client: buildClient(conn.accessToken) };
}

// Resolves the active mapping for a user's active connection.
async function resolveMapping(userId: string, subjectId?: string) {
  const conn = await getActiveConnection(userId, "notion");
  if (!conn) throw new Error(`No active Notion connection for user ${userId}`);
  const mapping = await getActiveMapping(conn.row.id, subjectId);
  if (!mapping) throw new Error(`No active structure mapping for user ${userId}`);
  const strategy = notionStrategies[mapping.strategy_key];
  if (!strategy) throw new Error(`Unknown strategy: ${mapping.strategy_key}`);
  return { conn, mapping, strategy };
}

// ---------------------------------------------------------------------------
// listTopLevelResourcesRich
// Returns rich database/page refs (with titles and icons) for the discovery
// wizard. Uses a separate Redis key so it does not conflict with the lean
// ResourceRef cache used by the ingest pipeline.
// ---------------------------------------------------------------------------

export async function listTopLevelResourcesRich(
  connectionId: string,
  accessToken: string,
): Promise<NotionTopResourcesRich> {
  const client = buildClient(accessToken);

  return cacheWrap<NotionTopResourcesRich>(
    `notion:topResRich:${connectionId}`,
    300, // 5 min TTL
    async () => {
      const databases: NotionDatabaseRef[] = [];
      const pages: NotionPageRef[] = [];

      for (const kind of ["database", "page"] as const) {
        let cursor: string | undefined;
        do {
          const body: Record<string, unknown> = {
            filter: { property: "object", value: kind },
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          };
          const res = await client.fetch<NotionSearchResponse>("/search", {
            method: "POST",
            body: JSON.stringify(body),
          });

          for (const item of res.results) {
            const icon = extractIcon(item.icon);

            if (kind === "database") {
              const title =
                item.title && item.title.length > 0
                  ? item.title.map((t) => t.plain_text).join("").trim() || item.id
                  : item.id;
              databases.push({ id: item.id, title, icon });
            } else {
              const title = extractPageTitleFromSearchResult(item);
              pages.push({ id: item.id, title, icon });
            }
          }

          cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
        } while (cursor);
      }

      return { databases, pages };
    },
  );
}

export const notionConnector: Connector = {
  source: "notion",

  async listTopLevelResources({ userId }): Promise<ResourceRef[]> {
    const { connectionId, client } = await resolveConnection(userId);

    return cacheWrap<ResourceRef[]>(
      `notion:topRes:${connectionId}`,
      300, // 5 min TTL
      async () => {
        const resources: ResourceRef[] = [];

        // Fetch databases and pages separately per Notion search API requirements.
        for (const kind of ["database", "page"] as const) {
          let cursor: string | undefined;
          do {
            const body: Record<string, unknown> = {
              filter: { property: "object", value: kind },
              page_size: 100,
              ...(cursor ? { start_cursor: cursor } : {}),
            };
            const res = await client.fetch<NotionSearchResponse>("/search", {
              method: "POST",
              body: JSON.stringify(body),
            });
            for (const item of res.results) {
              resources.push({
                source: "notion",
                externalId: item.id,
                kind,
              });
            }
            cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
          } while (cursor);
        }

        return resources;
      },
    );
  },

  async listSubjects({ userId }): Promise<Subject[]> {
    const { conn, mapping, strategy } = await resolveMapping(userId);
    const client = buildClient(conn.accessToken);

    return cacheWrap<Subject[]>(
      `notion:listSubjects:${conn.row.id}:${mapping.id}`,
      60,
      () =>
        strategy.resolveSubjects({
          config: mapping.config_json as Parameters<typeof strategy.resolveSubjects>[0]["config"],
          notionClient: client,
        }),
    );
  },

  async listUnits({ userId, subjectId }): Promise<Unit[]> {
    const { conn, mapping, strategy } = await resolveMapping(userId, subjectId);
    const client = buildClient(conn.accessToken);

    return cacheWrap<Unit[]>(
      `notion:listUnits:${conn.row.id}:${mapping.id}:${subjectId}`,
      60,
      () =>
        strategy.resolveUnits({
          config: mapping.config_json as Parameters<typeof strategy.resolveUnits>[0]["config"],
          notionClient: client,
          subjectId,
        }),
    );
  },

  async listNotes({ userId, subjectId, unitId }): Promise<NoteSummary[]> {
    const { conn, mapping, strategy } = await resolveMapping(userId, subjectId);
    const client = buildClient(conn.accessToken);

    return cacheWrap<NoteSummary[]>(
      `notion:listNotes:${conn.row.id}:${mapping.id}:${subjectId}:${unitId ?? "all"}`,
      60,
      () =>
        strategy.resolveNotes({
          config: mapping.config_json as Parameters<typeof strategy.resolveNotes>[0]["config"],
          notionClient: client,
          subjectId,
          unitId,
        }),
    );
  },

  async fetchNote({ userId, ref }): Promise<NoteContent> {
    const { conn, mapping, strategy } = await resolveMapping(userId);
    const client = buildClient(conn.accessToken);

    return cacheWrap<NoteContent>(
      `notion:fetchNote:${conn.row.id}:${mapping.id}:${ref.externalId}`,
      600, // 10 min TTL — note content changes less frequently
      () =>
        strategy.resolveNoteContent({
          config: mapping.config_json as Parameters<typeof strategy.resolveNoteContent>[0]["config"],
          notionClient: client,
          ref,
        }),
    );
  },
};
