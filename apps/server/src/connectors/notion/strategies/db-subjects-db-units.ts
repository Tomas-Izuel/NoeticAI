import { z } from "zod";
import type { NotionStrategy, SerializedConfigSchema, NotionDatabaseRef } from "./types";
import type { Subject, Unit, NoteSummary, NoteContent } from "@noeticai/connector-core";
import {
  paginateBlockChildren,
  paginateDb,
  blocksToNoteBlocks,
  extractPageTitleFromProperties,
} from "./_shared";

// ---------------------------------------------------------------------------
// Config schema for the "db-subjects-db-units" strategy.
// Validated on POST /api/connections/:id/mappings and PATCH .../mappings/:mid.
// ---------------------------------------------------------------------------

export const DbSubjectsDbUnitsConfigSchema = z.object({
  subjectsDbId: z.string().min(1),
  unitsDbId: z.string().min(1),
  subjectNameProp: z.string().default("Name"),
  unitNameProp: z.string().default("Name"),
  // Relation property on the units DB that points back to the subjects DB.
  subjectRefPropOnUnit: z.string().default("Subject"),
  // When notes live as child_pages of units this is not needed.
  unitRefPropOnNote: z.string().optional(),
});

export type DbSubjectsDbUnitsConfig = z.infer<typeof DbSubjectsDbUnitsConfigSchema>;

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

const uiSchema: SerializedConfigSchema = {
  subjectsDbId: {
    kind: "database",
    label: "Subjects database",
    required: true,
  },
  unitsDbId: {
    kind: "database",
    label: "Units database",
    required: true,
  },
  subjectNameProp: {
    kind: "property",
    label: "Subject name property",
    required: true,
    dependsOn: "subjectsDbId",
    propertyTypes: ["title"],
    default: "Name",
  },
  unitNameProp: {
    kind: "property",
    label: "Unit name property",
    required: true,
    dependsOn: "unitsDbId",
    propertyTypes: ["title"],
    default: "Name",
  },
  subjectRefPropOnUnit: {
    kind: "property",
    label: "Unit → Subject relation",
    required: true,
    dependsOn: "unitsDbId",
    propertyTypes: ["relation"],
    default: "Subject",
    help: "The relation property on the Units DB that links each unit back to its subject.",
  },
  unitRefPropOnNote: {
    kind: "property",
    label: "Note → Unit relation (optional)",
    required: false,
    dependsOn: "unitsDbId",
    propertyTypes: ["relation"],
  },
};

export const dbSubjectsDbUnitsStrategy: NotionStrategy<DbSubjectsDbUnitsConfig> = {
  key: "notion.db-subjects-db-units",

  descriptor: {
    key: "notion.db-subjects-db-units",
    source: "notion",
    label: "Subjects DB + Units DB",
    description:
      "Maps a Notion database of subjects and a related database of units. " +
      "Notes are child pages inside each unit page.",
    configSchema: uiSchema,
  },

  configSchema: DbSubjectsDbUnitsConfigSchema,

  uiSchema,

  async suggestConfig({ databases }) {
    // Heuristic: title-match against /subjects?/i and /units?|topics?|chapters?|modules?/i.
    // Pre-fill DB ids from the rich discovery list which now carries titles.
    let subjectsDbId: string | undefined;
    let unitsDbId: string | undefined;

    for (const db of databases) {
      if (!subjectsDbId && /subjects?/i.test(db.title)) {
        subjectsDbId = db.id;
        continue;
      }
      if (!unitsDbId && /units?|topics?|chapters?|modules?/i.test(db.title)) {
        unitsDbId = db.id;
        continue;
      }
    }

    // Positional fallback: if title heuristic didn't match, use order.
    if (!subjectsDbId && databases.length >= 1) {
      subjectsDbId = databases[0]!.id;
    }
    if (!unitsDbId && databases.length >= 2) {
      // Pick the second DB that isn't already the subjects one.
      const fallback = databases.find((db) => db.id !== subjectsDbId);
      if (fallback) unitsDbId = fallback.id;
    }

    const suggested: Partial<DbSubjectsDbUnitsConfig> = {};
    if (subjectsDbId) suggested.subjectsDbId = subjectsDbId;
    if (unitsDbId) suggested.unitsDbId = unitsDbId;
    return suggested;
  },

  async resolveSubjects({ config, notionClient }) {
    const pages = await paginateDb(notionClient, config.subjectsDbId);
    return pages.map((page) => ({
      id: page.id,
      name: extractPageTitleFromProperties(page, config.subjectNameProp),
    }));
  },

  async resolveUnits({ config, notionClient, subjectId }) {
    const filter: Record<string, unknown> = {
      property: config.subjectRefPropOnUnit,
      relation: { contains: subjectId },
    };

    const pages = await paginateDb(notionClient, config.unitsDbId, filter);
    return pages.map((page, index) => ({
      id: page.id,
      subjectId,
      order: index,
      name: extractPageTitleFromProperties(page, config.unitNameProp),
      sourceUnitRef: {
        source: "notion" as const,
        externalId: page.id,
        kind: "page" as const,
      },
    }));
  },

  async resolveNotes({ notionClient, subjectId, unitId }) {
    // Notes are child_page blocks inside unit pages.
    // If a unitId is provided we fetch only that unit's children; otherwise we'd need
    // to enumerate all units — callers should prefer providing unitId for efficiency.
    const targetUnitId = unitId ?? subjectId;
    const blocks = await paginateBlockChildren(notionClient, targetUnitId);

    return blocks
      .filter((b) => b.type === "child_page")
      .map((b): NoteSummary => ({
        ref: {
          source: "notion",
          externalId: b.id,
          kind: "page",
        },
        title: (b.child_page as { title: string } | undefined)?.title ?? b.id,
        updatedAtExternal: new Date().toISOString(),
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
