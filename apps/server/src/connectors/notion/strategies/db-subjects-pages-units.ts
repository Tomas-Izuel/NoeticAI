import { z } from "zod";
import type { NotionStrategy, SerializedConfigSchema } from "./types";
import type { Subject, Unit, NoteSummary, NoteContent } from "@noeticai/connector-core";
import {
  paginateDb,
  listChildPages,
  paginateBlockChildren,
  blocksToNoteBlocks,
  extractPlainText,
  extractPageTitleFromProperties,
  type NotionPage,
  type NotionProperty,
  type NotionDatabase,
} from "./_shared";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const DbSubjectsPagesUnitsConfigSchema = z.object({
  subjectsDbId: z.string().min(1),
  subjectNameProp: z.string().default("Name"),
  // Optional rich metadata columns — not required for the core tree.
  courseProperty: z.string().optional(),
  termProperty: z.string().optional(),
  glyphProperty: z.string().optional(),
});

export type DbSubjectsPagesUnitsConfig = z.infer<typeof DbSubjectsPagesUnitsConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readTextProp(page: NotionPage, propName: string | undefined): string | undefined {
  if (!propName) return undefined;
  const prop: NotionProperty | undefined = page.properties[propName];
  if (!prop) return undefined;
  if (prop.type === "rich_text") return extractPlainText(prop.rich_text) || undefined;
  if (prop.type === "title") return extractPlainText(prop.title) || undefined;
  // For select / status properties, use the name field.
  if (prop.type === "select" && prop.select?.name) return prop.select.name;
  if (prop.type === "status" && prop.status?.name) return prop.status.name;
  return undefined;
}

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

const uiSchema: SerializedConfigSchema = {
  subjectsDbId: {
    kind: "database",
    label: "Subjects database",
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
  courseProperty: {
    kind: "property",
    label: "Course property (optional)",
    required: false,
    dependsOn: "subjectsDbId",
    propertyTypes: ["rich_text", "select", "title"],
  },
  termProperty: {
    kind: "property",
    label: "Term property (optional)",
    required: false,
    dependsOn: "subjectsDbId",
    propertyTypes: ["rich_text", "select"],
  },
  glyphProperty: {
    kind: "property",
    label: "Glyph property (optional)",
    required: false,
    dependsOn: "subjectsDbId",
    propertyTypes: ["rich_text", "select"],
    help: "An emoji or short label shown next to the subject.",
  },
};

export const dbSubjectsPagesUnitsStrategy: NotionStrategy<DbSubjectsPagesUnitsConfig> = {
  key: "notion.db-subjects-pages-units",

  descriptor: {
    key: "notion.db-subjects-pages-units",
    source: "notion",
    label: "Subjects DB + Page Hierarchy",
    description:
      "Subjects live in a database (with rich metadata like course/term). " +
      "Units and Notes are pages nested inside each Subject page.",
    configSchema: uiSchema,
  },

  configSchema: DbSubjectsPagesUnitsConfigSchema,

  uiSchema,

  async suggestConfig({ databases, notionClient }) {
    if (databases.length === 0) return {};

    // Title-match heuristic using the rich DB list (titles already available — no extra fetch).
    // Fall back to fetching the DB for property sniffing only when we find a matching title.
    let subjectsDbId: string = databases[0]!.id;
    let courseProperty: string | undefined;
    let termProperty: string | undefined;
    let glyphProperty: string | undefined;

    for (const db of databases) {
      if (/subjects?|courses?/i.test(db.title)) {
        subjectsDbId = db.id;
        // Fetch the full DB object to sniff property names.
        try {
          const dbObj = await notionClient.fetch<NotionDatabase>(`/databases/${db.id}`);
          for (const [propName] of Object.entries(dbObj.properties)) {
            const lower = propName.toLowerCase();
            if (/^course$/i.test(lower)) courseProperty = propName;
            if (/^term$/i.test(lower)) termProperty = propName;
            if (/^(glyph|icon|emoji)$/i.test(lower)) glyphProperty = propName;
          }
        } catch {
          // Ignore fetch failure — property names stay unset.
        }
        break;
      }
    }

    return {
      subjectsDbId,
      ...(courseProperty ? { courseProperty } : {}),
      ...(termProperty ? { termProperty } : {}),
      ...(glyphProperty ? { glyphProperty } : {}),
    };
  },

  async resolveSubjects({ config, notionClient }) {
    const pages = await paginateDb(notionClient, config.subjectsDbId);

    return pages.map((page) => {
      const subject: Subject = {
        id: page.id,
        name: extractPageTitleFromProperties(page, config.subjectNameProp),
      };

      const course = readTextProp(page, config.courseProperty);
      const term = readTextProp(page, config.termProperty);
      const glyph = readTextProp(page, config.glyphProperty);

      if (course) subject.course = course;
      if (term) subject.term = term;
      if (glyph) subject.glyph = glyph;

      return subject;
    });
  },

  async resolveUnits({ config: _config, notionClient, subjectId }) {
    const children = await listChildPages(notionClient, subjectId);
    return children.map((c, index) => ({
      id: c.id,
      subjectId,
      order: index,
      name: c.title,
      sourceUnitRef: {
        source: "notion" as const,
        externalId: c.id,
        kind: "page" as const,
      },
    }));
  },

  async resolveNotes({ config: _config, notionClient, unitId, subjectId }) {
    const targetId = unitId ?? subjectId;
    const children = await listChildPages(notionClient, targetId);
    return children.map((c) => ({
      ref: {
        source: "notion" as const,
        externalId: c.id,
        kind: "page" as const,
      },
      title: c.title,
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
