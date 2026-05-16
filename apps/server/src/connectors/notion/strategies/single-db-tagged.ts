import { z } from "zod";
import type { NotionStrategy, NotionClient, SerializedConfigSchema } from "./types";
import type { Subject, Unit, NoteSummary, NoteContent } from "@noeticai/connector-core";
import {
  paginateDb,
  paginateBlockChildren,
  blocksToNoteBlocks,
  extractPageTitleFromProperties,
  type NotionPage,
} from "./_shared";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const SingleDbTaggedConfigSchema = z.object({
  databaseId: z.string().min(1),
  typeProperty: z.string().default("Type"),
  subjectTypeValue: z.string().default("Subject"),
  unitTypeValue: z.string().default("Unit"),
  noteTypeValue: z.string().default("Note"),
  parentRelationProperty: z.string().default("Parent"),
  nameProperty: z.string().default("Name"),
});

export type SingleDbTaggedConfig = z.infer<typeof SingleDbTaggedConfigSchema>;

// ---------------------------------------------------------------------------
// Helper: build a select or status filter for the type property.
// Notion returns a property-type error if you use "select" on a "status"
// property and vice versa. We try "select" first and fall back to "status"
// at the paginateDb level by catching the API error.
// ---------------------------------------------------------------------------

function selectOrStatusFilter(
  property: string,
  value: string,
  kind: "select" | "status",
): Record<string, unknown> {
  return {
    property,
    [kind]: { equals: value },
  };
}

async function queryByTypeWithFallback(
  client: NotionClient,
  dbId: string,
  typeProperty: string,
  typeValue: string,
  extraFilter?: Record<string, unknown>,
): Promise<NotionPage[]> {
  const baseFilter = selectOrStatusFilter(typeProperty, typeValue, "select");
  const filter: Record<string, unknown> = extraFilter
    ? { and: [baseFilter, extraFilter] }
    : baseFilter;

  try {
    return await paginateDb(client, dbId, filter);
  } catch {
    // Fall back to status property type.
    const statusFilter = selectOrStatusFilter(typeProperty, typeValue, "status");
    const fallbackFilter: Record<string, unknown> = extraFilter
      ? { and: [statusFilter, extraFilter] }
      : statusFilter;
    return await paginateDb(client, dbId, fallbackFilter);
  }
}

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

const uiSchema: SerializedConfigSchema = {
  databaseId: {
    kind: "database",
    label: "Database",
    required: true,
  },
  typeProperty: {
    kind: "property",
    label: "Type property",
    required: true,
    dependsOn: "databaseId",
    propertyTypes: ["select", "status"],
    default: "Type",
  },
  subjectTypeValue: {
    kind: "select-option",
    label: "Subject type value",
    required: true,
    dependsOnDatabase: "databaseId",
    dependsOnProperty: "typeProperty",
    default: "Subject",
  },
  unitTypeValue: {
    kind: "select-option",
    label: "Unit type value",
    required: true,
    dependsOnDatabase: "databaseId",
    dependsOnProperty: "typeProperty",
    default: "Unit",
  },
  noteTypeValue: {
    kind: "select-option",
    label: "Note type value",
    required: true,
    dependsOnDatabase: "databaseId",
    dependsOnProperty: "typeProperty",
    default: "Note",
  },
  parentRelationProperty: {
    kind: "property",
    label: "Parent relation property",
    required: true,
    dependsOn: "databaseId",
    propertyTypes: ["relation"],
    default: "Parent",
  },
  nameProperty: {
    kind: "property",
    label: "Name property",
    required: true,
    dependsOn: "databaseId",
    propertyTypes: ["title"],
    default: "Name",
  },
};

export const singleDbTaggedStrategy: NotionStrategy<SingleDbTaggedConfig> = {
  key: "notion.single-db-tagged",

  descriptor: {
    key: "notion.single-db-tagged",
    source: "notion",
    label: "Single DB (Tagged Rows)",
    description:
      "All rows live in one database. A select/status property tags each row " +
      "as Subject, Unit, or Note, and a self-referencing relation defines the tree.",
    configSchema: uiSchema,
  },

  configSchema: SingleDbTaggedConfigSchema,

  uiSchema,

  async suggestConfig({ databases, notionClient }) {
    if (databases.length === 0) return {};
    if (databases.length === 1) {
      return { databaseId: databases[0]!.id };
    }

    // Multiple DBs — pick the one with the most rows by issuing a page_size=1 query
    // and comparing has_more (more rows = larger DB). We pick the largest as a
    // heuristic for the "all-in-one" database. Cap at top 5 candidates.
    let bestId = databases[0]!.id;
    let bestHasMore = false;

    const candidates = databases.slice(0, 5);
    for (const db of candidates) {
      try {
        const res = await notionClient.fetch<{
          results: unknown[];
          has_more: boolean;
        }>(`/databases/${db.id}/query`, {
          method: "POST",
          body: JSON.stringify({ page_size: 1 }),
        });
        // Prefer a DB with has_more=true (it has > 1 row) over one with has_more=false.
        // Among multiple DBs with has_more=true we keep the first encountered.
        if (!bestHasMore && res.has_more) {
          bestId = db.id;
          bestHasMore = true;
        }
      } catch {
        // Ignore fetch failures for individual DBs — user can fill in manually.
      }
    }

    return { databaseId: bestId };
  },

  async resolveSubjects({ config, notionClient }) {
    const pages = await queryByTypeWithFallback(
      notionClient,
      config.databaseId,
      config.typeProperty,
      config.subjectTypeValue,
    );

    return pages.map((page) => ({
      id: page.id,
      name: extractPageTitleFromProperties(page, config.nameProperty),
    }));
  },

  async resolveUnits({ config, notionClient, subjectId }) {
    const parentFilter: Record<string, unknown> = {
      property: config.parentRelationProperty,
      relation: { contains: subjectId },
    };

    const pages = await queryByTypeWithFallback(
      notionClient,
      config.databaseId,
      config.typeProperty,
      config.unitTypeValue,
      parentFilter,
    );

    return pages.map((page, index) => ({
      id: page.id,
      subjectId,
      order: index,
      name: extractPageTitleFromProperties(page, config.nameProperty),
      sourceUnitRef: {
        source: "notion" as const,
        externalId: page.id,
        kind: "page" as const,
      },
    }));
  },

  async resolveNotes({ config, notionClient, subjectId, unitId }) {
    const parentId = unitId ?? subjectId;
    const parentFilter: Record<string, unknown> = {
      property: config.parentRelationProperty,
      relation: { contains: parentId },
    };

    const pages = await queryByTypeWithFallback(
      notionClient,
      config.databaseId,
      config.typeProperty,
      config.noteTypeValue,
      parentFilter,
    );

    return pages.map((page) => ({
      ref: {
        source: "notion" as const,
        externalId: page.id,
        kind: "page" as const,
      },
      title: extractPageTitleFromProperties(page, config.nameProperty),
      updatedAtExternal: page.last_edited_time,
      unitId: unitId ?? null,
    }));
  },

  async resolveNoteContent({ notionClient, ref }) {
    const blocks = await paginateBlockChildren(notionClient, ref.externalId);
    return {
      ref,
      title: ref.externalId,
      blocks: blocksToNoteBlocks(blocks),
    };
  },
};
