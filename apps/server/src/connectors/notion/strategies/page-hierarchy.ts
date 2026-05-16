import { z } from "zod";
import type { NotionStrategy, SerializedConfigSchema } from "./types";
import type { Subject, Unit, NoteSummary, NoteContent } from "@noeticai/connector-core";
import {
  listChildPages,
  paginateBlockChildren,
  blocksToNoteBlocks,
} from "./_shared";

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const PageHierarchyConfigSchema = z.object({
  rootPageId: z.string().min(1),
  // depth=3: Root → Subject → Unit → Note
  // depth=2: Root → Subject → Note (units flattened into a synthetic "Notes" unit)
  depth: z.union([z.literal(2), z.literal(3)]).default(3),
});

export type PageHierarchyConfig = z.infer<typeof PageHierarchyConfigSchema>;

// ---------------------------------------------------------------------------
// Strategy implementation
// ---------------------------------------------------------------------------

const uiSchema: SerializedConfigSchema = {
  rootPageId: {
    kind: "page",
    label: "Root page",
    required: true,
  },
  depth: {
    kind: "enum",
    label: "Depth",
    required: true,
    default: "3",
    options: [
      {
        value: "3",
        label: "Root → Subject → Unit → Notes",
        description: "Three levels of nesting (recommended).",
      },
      {
        value: "2",
        label: "Root → Subject → Notes",
        description: "Notes live directly under each subject; no unit grouping.",
      },
    ],
  },
};

export const pageHierarchyStrategy: NotionStrategy<PageHierarchyConfig> = {
  key: "notion.page-hierarchy",

  descriptor: {
    key: "notion.page-hierarchy",
    source: "notion",
    label: "Page Hierarchy (No DBs)",
    description:
      "Notes live as a nested page tree under a root page — no databases required. " +
      "Choose depth 3 (Root → Subject → Unit → Note) or depth 2 (Root → Subject → Note).",
    configSchema: uiSchema,
  },

  configSchema: PageHierarchyConfigSchema,

  uiSchema,

  async suggestConfig({ pages }) {
    if (pages.length === 0) return {};

    // Pick the most recently edited top-level page as the root.
    // The rich discovery list carries titles but not last_edited_time;
    // we pick the first page as a conservative default (the user can override in the wizard).
    return {
      rootPageId: pages[0]!.id,
      depth: 3,
    };
  },

  async resolveSubjects({ config, notionClient }) {
    const children = await listChildPages(notionClient, config.rootPageId);
    return children.map((c) => ({
      id: c.id,
      name: c.title,
    }));
  },

  async resolveUnits({ config, notionClient, subjectId }) {
    if (config.depth === 3) {
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
    }

    // depth=2: synthetic single unit containing all notes for this subject.
    // The id uses a stable prefix so the ingest pipeline's upsert is idempotent.
    return [
      {
        id: `${subjectId}:notes`,
        subjectId,
        order: 0,
        name: "Notes",
        sourceUnitRef: null,
      },
    ];
  },

  async resolveNotes({ config, notionClient, subjectId, unitId }) {
    if (config.depth === 3) {
      // Notes are child pages of the unit page.
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
    }

    // depth=2: notes are direct children of the subject page.
    const children = await listChildPages(notionClient, subjectId);
    return children.map((c) => ({
      ref: {
        source: "notion" as const,
        externalId: c.id,
        kind: "page" as const,
      },
      title: c.title,
      updatedAtExternal: new Date().toISOString(),
      // Stable synthetic unit id so FK constraints in the ingest pipeline resolve.
      unitId: `${subjectId}:notes`,
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
