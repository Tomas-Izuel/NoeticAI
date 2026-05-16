import { z } from "zod";
import type { NotionStrategy, SerializedConfigSchema } from "./types";
import type { Subject, Unit, NoteSummary, NoteContent } from "@noeticai/connector-core";
import {
  paginateDb,
  paginateBlockChildren,
  blocksToNoteBlocks,
  extractPageTitleFromProperties,
} from "./_shared";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const ThreeDbsConfigSchema = z.object({
  subjectsDbId: z.string().min(1),
  unitsDbId: z.string().min(1),
  notesDbId: z.string().min(1),
  subjectsNameProp: z.string().default("Name"),
  unitsNameProp: z.string().default("Name"),
  notesNameProp: z.string().default("Name"),
  unitToSubjectRelProperty: z.string().default("Subject"),
  noteToUnitRelProperty: z.string().default("Unit"),
});

export type ThreeDbsConfig = z.infer<typeof ThreeDbsConfigSchema>;

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
  notesDbId: {
    kind: "database",
    label: "Notes database",
    required: true,
  },
  subjectsNameProp: {
    kind: "property",
    label: "Subject name property",
    required: true,
    dependsOn: "subjectsDbId",
    propertyTypes: ["title"],
    default: "Name",
  },
  unitsNameProp: {
    kind: "property",
    label: "Unit name property",
    required: true,
    dependsOn: "unitsDbId",
    propertyTypes: ["title"],
    default: "Name",
  },
  notesNameProp: {
    kind: "property",
    label: "Note name property",
    required: true,
    dependsOn: "notesDbId",
    propertyTypes: ["title"],
    default: "Name",
  },
  unitToSubjectRelProperty: {
    kind: "property",
    label: "Unit → Subject relation",
    required: true,
    dependsOn: "unitsDbId",
    propertyTypes: ["relation"],
    default: "Subject",
  },
  noteToUnitRelProperty: {
    kind: "property",
    label: "Note → Unit relation",
    required: true,
    dependsOn: "notesDbId",
    propertyTypes: ["relation"],
    default: "Unit",
  },
};

export const threeDbsStrategy: NotionStrategy<ThreeDbsConfig> = {
  key: "notion.three-dbs",

  descriptor: {
    key: "notion.three-dbs",
    source: "notion",
    label: "Three Databases (Normalized)",
    description:
      "Fully-normalized setup: three separate databases for Subjects, Units, and Notes, " +
      "linked by relation properties. Most rigorous Notion workspace structure.",
    configSchema: uiSchema,
  },

  configSchema: ThreeDbsConfigSchema,

  uiSchema,

  async suggestConfig({ databases }) {
    // Title-match using the rich discovery list (titles already available — no extra fetch needed).
    if (databases.length === 0) return {};

    let subjectsDbId: string | undefined;
    let unitsDbId: string | undefined;
    let notesDbId: string | undefined;

    for (const db of databases) {
      if (subjectsDbId && unitsDbId && notesDbId) break;

      if (!subjectsDbId && /subjects?|courses?/i.test(db.title)) {
        subjectsDbId = db.id;
        continue;
      }
      if (!unitsDbId && /units?|topics?|chapters?|modules?/i.test(db.title)) {
        unitsDbId = db.id;
        continue;
      }
      if (!notesDbId && /notes?|pages?/i.test(db.title)) {
        notesDbId = db.id;
        continue;
      }
    }

    // Return whatever we found; empty fields will require manual input.
    const result: Partial<ThreeDbsConfig> = {};
    if (subjectsDbId) result.subjectsDbId = subjectsDbId;
    if (unitsDbId) result.unitsDbId = unitsDbId;
    if (notesDbId) result.notesDbId = notesDbId;
    return result;
  },

  async resolveSubjects({ config, notionClient }) {
    const pages = await paginateDb(notionClient, config.subjectsDbId);
    return pages.map((page) => ({
      id: page.id,
      name: extractPageTitleFromProperties(page, config.subjectsNameProp),
    }));
  },

  async resolveUnits({ config, notionClient, subjectId }) {
    const filter: Record<string, unknown> = {
      property: config.unitToSubjectRelProperty,
      relation: { contains: subjectId },
    };

    const pages = await paginateDb(notionClient, config.unitsDbId, filter);
    return pages.map((page, index) => ({
      id: page.id,
      subjectId,
      order: index,
      name: extractPageTitleFromProperties(page, config.unitsNameProp),
      sourceUnitRef: {
        source: "notion" as const,
        externalId: page.id,
        kind: "page" as const,
      },
    }));
  },

  async resolveNotes({ config, notionClient, unitId, subjectId }) {
    const parentId = unitId ?? subjectId;
    const filter: Record<string, unknown> = {
      property: config.noteToUnitRelProperty,
      relation: { contains: parentId },
    };

    const pages = await paginateDb(notionClient, config.notesDbId, filter);
    return pages.map((page) => ({
      ref: {
        source: "notion" as const,
        externalId: page.id,
        kind: "page" as const,
      },
      title: extractPageTitleFromProperties(page, config.notesNameProp),
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
