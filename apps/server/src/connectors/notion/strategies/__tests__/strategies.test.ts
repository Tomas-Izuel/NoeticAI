/**
 * Unit tests for all five Notion strategies.
 *
 * The Notion API is mocked via a simple fake NotionClient so no network calls
 * are made. Each test section covers one strategy: happy-path resolveSubjects,
 * resolveUnits, resolveNotes, and suggestConfig.
 *
 * Run with: bun test src/connectors/notion/strategies/__tests__/strategies.test.ts
 */

import { test, expect, describe, mock, beforeEach } from "bun:test";
import type { NotionClient, NotionDatabaseRef, NotionPageRef } from "../types";

// ---------------------------------------------------------------------------
// Strategy imports
// ---------------------------------------------------------------------------
import { dbSubjectsDbUnitsStrategy } from "../db-subjects-db-units";
import { singleDbTaggedStrategy } from "../single-db-tagged";
import { pageHierarchyStrategy } from "../page-hierarchy";
import { dbSubjectsPagesUnitsStrategy } from "../db-subjects-pages-units";
import { threeDbsStrategy } from "../three-dbs";

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------

function makePage(
  id: string,
  namePropType: "title" | "rich_text",
  nameValue: string,
  extraProps: Record<string, unknown> = {},
  lastEdited = "2024-01-01T00:00:00.000Z",
) {
  return {
    id,
    last_edited_time: lastEdited,
    properties: {
      Name: {
        type: namePropType,
        [namePropType]: [{ plain_text: nameValue }],
      },
      ...extraProps,
    },
  };
}

function makeDbQueryResponse(pages: unknown[], hasMore = false) {
  return { results: pages, next_cursor: null, has_more: hasMore };
}

function makeBlockChildrenResponse(blocks: unknown[], hasMore = false) {
  return { results: blocks, next_cursor: null, has_more: hasMore };
}

function makeChildPageBlock(id: string, title: string) {
  return { id, type: "child_page", child_page: { title } };
}

function makeParagraphBlock(id: string, text: string) {
  return {
    id,
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: text }] },
  };
}

function makeDbObject(id: string, titleText: string) {
  return { id, title: [{ plain_text: titleText }], properties: {} };
}

function makeDbRefs(ids: string[]): NotionDatabaseRef[] {
  return ids.map((id) => ({ id, title: id, icon: null }));
}

function makePageRefs(ids: string[]): NotionPageRef[] {
  return ids.map((id) => ({ id, title: id, icon: null }));
}

// ---------------------------------------------------------------------------
// 1. notion.db-subjects-db-units
// ---------------------------------------------------------------------------

describe("notion.db-subjects-db-units", () => {
  const config = {
    subjectsDbId: "db-subjects",
    unitsDbId: "db-units",
    subjectNameProp: "Name",
    unitNameProp: "Name",
    subjectRefPropOnUnit: "Subject",
  };

  const subjectPages = [
    makePage("subj-1", "title", "Biology"),
    makePage("subj-2", "title", "Chemistry"),
  ];
  const unitPages = [
    makePage("unit-1", "title", "Cell Biology"),
    makePage("unit-2", "title", "Genetics"),
  ];
  const noteBlocks = [
    makeChildPageBlock("note-1", "Chapter 1 Notes"),
    makeChildPageBlock("note-2", "Chapter 2 Notes"),
    makeParagraphBlock("par-1", "Ignored paragraph"),
  ];
  const contentBlocks = [makeParagraphBlock("b-1", "Introduction text")];

  function makeClient(): NotionClient {
    return {
      fetch: mock(async (path: string, init?: RequestInit) => {
        if (path.includes("/databases/db-subjects/query")) {
          return makeDbQueryResponse(subjectPages);
        }
        if (path.includes("/databases/db-units/query")) {
          return makeDbQueryResponse(unitPages);
        }
        if (path.includes("/blocks/unit-1/children")) {
          return makeBlockChildrenResponse(noteBlocks);
        }
        if (path.includes("/blocks/note-1/children")) {
          return makeBlockChildrenResponse(contentBlocks);
        }
        return makeBlockChildrenResponse([]);
      }) as NotionClient["fetch"],
    };
  }

  test("suggestConfig: two DBs → first = subjects, second = units", async () => {
    const databases = makeDbRefs(["db-subjects", "db-units"]);
    const client = makeClient();
    const cfg = await dbSubjectsDbUnitsStrategy.suggestConfig({ databases, pages: [], notionClient: client });
    expect(cfg.subjectsDbId).toBe("db-subjects");
    expect(cfg.unitsDbId).toBe("db-units");
  });

  test("suggestConfig: one DB → only subjectsDbId set", async () => {
    const databases = makeDbRefs(["db-only"]);
    const client = makeClient();
    const cfg = await dbSubjectsDbUnitsStrategy.suggestConfig({ databases, pages: [], notionClient: client });
    expect(cfg.subjectsDbId).toBe("db-only");
    expect(cfg.unitsDbId).toBeUndefined();
  });

  test("resolveSubjects: returns all pages with correct id + name", async () => {
    const subjects = await dbSubjectsDbUnitsStrategy.resolveSubjects({
      config,
      notionClient: makeClient(),
    });
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toMatchObject({ id: "subj-1", name: "Biology" });
    expect(subjects[1]).toMatchObject({ id: "subj-2", name: "Chemistry" });
  });

  test("resolveUnits: returns units with subjectId, order, sourceUnitRef", async () => {
    const units = await dbSubjectsDbUnitsStrategy.resolveUnits({
      config,
      notionClient: makeClient(),
      subjectId: "subj-1",
    });
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      id: "unit-1",
      subjectId: "subj-1",
      order: 0,
      name: "Cell Biology",
      sourceUnitRef: { source: "notion", externalId: "unit-1", kind: "page" },
    });
    expect(units[1]!.order).toBe(1);
  });

  test("resolveNotes: returns only child_page blocks as notes", async () => {
    const notes = await dbSubjectsDbUnitsStrategy.resolveNotes({
      config,
      notionClient: makeClient(),
      subjectId: "subj-1",
      unitId: "unit-1",
    });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      ref: { source: "notion", externalId: "note-1", kind: "page" },
      title: "Chapter 1 Notes",
      unitId: "unit-1",
    });
  });

  test("resolveNoteContent: maps paragraph blocks correctly", async () => {
    const content = await dbSubjectsDbUnitsStrategy.resolveNoteContent({
      config,
      notionClient: makeClient(),
      ref: { source: "notion", externalId: "note-1", kind: "page" },
    });
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]).toMatchObject({ kind: "paragraph", text: "Introduction text" });
  });
});

// ---------------------------------------------------------------------------
// 2. notion.single-db-tagged
// ---------------------------------------------------------------------------

describe("notion.single-db-tagged", () => {
  const config = {
    databaseId: "db-all",
    typeProperty: "Type",
    subjectTypeValue: "Subject",
    unitTypeValue: "Unit",
    noteTypeValue: "Note",
    parentRelationProperty: "Parent",
    nameProperty: "Name",
  };

  function makeTaggedPage(
    id: string,
    name: string,
    typeVal: string,
    parentId?: string,
    lastEdited = "2024-01-01T00:00:00.000Z",
  ) {
    return {
      id,
      last_edited_time: lastEdited,
      properties: {
        Name: { type: "title", title: [{ plain_text: name }] },
        Type: { type: "select", select: { name: typeVal } },
        ...(parentId
          ? { Parent: { type: "relation", relation: [{ id: parentId }] } }
          : {}),
      },
    };
  }

  const subjectPage = makeTaggedPage("s-1", "Maths", "Subject");
  const unitPage = makeTaggedPage("u-1", "Algebra", "Unit", "s-1");
  const notePage = makeTaggedPage("n-1", "Intro to Algebra", "Note", "u-1");
  const contentBlock = makeParagraphBlock("b-1", "Algebra fundamentals");

  function makeClient(): NotionClient {
    return {
      fetch: mock(async (path: string, init?: RequestInit) => {
        const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
        const filter = body["filter"] as Record<string, unknown> | undefined;

        // Row-count probe (page_size=1 for suggestConfig)
        if (path.includes("/databases/") && path.includes("/query")) {
          const ps = body["page_size"];
          if (ps === 1) {
            return { results: [subjectPage], next_cursor: null, has_more: true };
          }
        }

        if (path.includes("/databases/db-all/query")) {
          // Determine which type-filter is being applied.
          const typeFilter =
            (filter && "property" in filter
              ? filter
              : (filter as { and?: unknown[] } | undefined)?.and?.[0]) as
              | { select?: { equals: string }; status?: { equals: string } }
              | undefined;

          const typeVal =
            typeFilter?.select?.equals ?? typeFilter?.status?.equals;

          if (typeVal === "Subject") return makeDbQueryResponse([subjectPage]);
          if (typeVal === "Unit") return makeDbQueryResponse([unitPage]);
          if (typeVal === "Note") return makeDbQueryResponse([notePage]);
          return makeDbQueryResponse([]);
        }

        if (path.includes("/blocks/n-1/children")) {
          return makeBlockChildrenResponse([contentBlock]);
        }
        return makeBlockChildrenResponse([]);
      }) as NotionClient["fetch"],
    };
  }

  test("suggestConfig: one DB → databaseId set", async () => {
    const databases = makeDbRefs(["db-all"]);
    const client = makeClient();
    const cfg = await singleDbTaggedStrategy.suggestConfig({ databases, pages: [], notionClient: client });
    expect(cfg.databaseId).toBe("db-all");
  });

  test("suggestConfig: multiple DBs → picks DB with has_more=true", async () => {
    const databases = makeDbRefs(["db-small", "db-all"]);
    // db-small returns has_more=false (only 0 rows returned), db-all returns has_more=true
    const client: NotionClient = {
      fetch: mock(async (path: string, init?: RequestInit) => {
        if (path.includes("db-small")) {
          return { results: [], next_cursor: null, has_more: false };
        }
        return { results: [subjectPage], next_cursor: null, has_more: true };
      }) as NotionClient["fetch"],
    };
    const cfg = await singleDbTaggedStrategy.suggestConfig({ databases, pages: [], notionClient: client });
    expect(cfg.databaseId).toBe("db-all");
  });

  test("resolveSubjects: returns subject-type rows", async () => {
    const subjects = await singleDbTaggedStrategy.resolveSubjects({
      config,
      notionClient: makeClient(),
    });
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ id: "s-1", name: "Maths" });
  });

  test("resolveUnits: returns unit-type rows filtered by subjectId", async () => {
    const units = await singleDbTaggedStrategy.resolveUnits({
      config,
      notionClient: makeClient(),
      subjectId: "s-1",
    });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "u-1",
      subjectId: "s-1",
      order: 0,
      name: "Algebra",
    });
  });

  test("resolveNotes: returns note-type rows filtered by unitId", async () => {
    const notes = await singleDbTaggedStrategy.resolveNotes({
      config,
      notionClient: makeClient(),
      subjectId: "s-1",
      unitId: "u-1",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      ref: { source: "notion", externalId: "n-1" },
      title: "Intro to Algebra",
      unitId: "u-1",
    });
  });

  test("resolveNoteContent: returns mapped blocks", async () => {
    const content = await singleDbTaggedStrategy.resolveNoteContent({
      config,
      notionClient: makeClient(),
      ref: { source: "notion", externalId: "n-1", kind: "page" },
    });
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]).toMatchObject({ kind: "paragraph", text: "Algebra fundamentals" });
  });
});

// ---------------------------------------------------------------------------
// 3. notion.page-hierarchy
// ---------------------------------------------------------------------------

describe("notion.page-hierarchy", () => {
  const subjectBlocks = [
    makeChildPageBlock("subj-p1", "Physics"),
    makeChildPageBlock("subj-p2", "Chemistry"),
  ];
  const unitBlocks = [
    makeChildPageBlock("unit-p1", "Mechanics"),
    makeChildPageBlock("unit-p2", "Thermodynamics"),
  ];
  const noteBlocks = [
    makeChildPageBlock("note-p1", "Lecture 1"),
  ];
  const contentBlocks = [makeParagraphBlock("b-1", "Some content")];

  function makeClient(): NotionClient {
    return {
      fetch: mock(async (path: string) => {
        if (path.includes("/blocks/root-page/children")) {
          return makeBlockChildrenResponse(subjectBlocks);
        }
        if (path.includes("/blocks/subj-p1/children")) {
          return makeBlockChildrenResponse(unitBlocks);
        }
        if (path.includes("/blocks/unit-p1/children")) {
          return makeBlockChildrenResponse(noteBlocks);
        }
        if (path.includes("/blocks/note-p1/children")) {
          return makeBlockChildrenResponse(contentBlocks);
        }
        return makeBlockChildrenResponse([]);
      }) as NotionClient["fetch"],
    };
  }

  describe("depth=3", () => {
    const config = { rootPageId: "root-page", depth: 3 as const };

    test("suggestConfig: picks first page from pages list", async () => {
      const pages = makePageRefs(["root-page", "other-page"]);
      const client = makeClient();
      const cfg = await pageHierarchyStrategy.suggestConfig({ databases: [], pages, notionClient: client });
      expect(cfg.rootPageId).toBe("root-page");
      expect(cfg.depth).toBe(3);
    });

    test("resolveSubjects: child pages of root become subjects", async () => {
      const subjects = await pageHierarchyStrategy.resolveSubjects({
        config,
        notionClient: makeClient(),
      });
      expect(subjects).toHaveLength(2);
      expect(subjects[0]).toMatchObject({ id: "subj-p1", name: "Physics" });
    });

    test("resolveUnits (depth=3): child pages of subject become units", async () => {
      const units = await pageHierarchyStrategy.resolveUnits({
        config,
        notionClient: makeClient(),
        subjectId: "subj-p1",
      });
      expect(units).toHaveLength(2);
      expect(units[0]).toMatchObject({
        id: "unit-p1",
        subjectId: "subj-p1",
        order: 0,
        name: "Mechanics",
        sourceUnitRef: { source: "notion", externalId: "unit-p1" },
      });
    });

    test("resolveNotes (depth=3): child pages of unit become notes", async () => {
      const notes = await pageHierarchyStrategy.resolveNotes({
        config,
        notionClient: makeClient(),
        subjectId: "subj-p1",
        unitId: "unit-p1",
      });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        ref: { source: "notion", externalId: "note-p1" },
        title: "Lecture 1",
        unitId: "unit-p1",
      });
    });
  });

  describe("depth=2", () => {
    const config = { rootPageId: "root-page", depth: 2 as const };

    test("resolveUnits (depth=2): returns single synthetic unit", async () => {
      const units = await pageHierarchyStrategy.resolveUnits({
        config,
        notionClient: makeClient(),
        subjectId: "subj-p1",
      });
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({
        id: "subj-p1:notes",
        subjectId: "subj-p1",
        order: 0,
        name: "Notes",
        sourceUnitRef: null,
      });
    });

    test("resolveNotes (depth=2): notes are child pages of subject with synthetic unitId", async () => {
      const notes = await pageHierarchyStrategy.resolveNotes({
        config,
        notionClient: makeClient(),
        subjectId: "subj-p1",
      });
      expect(notes).toHaveLength(2);
      // All notes reference the synthetic unit id.
      for (const note of notes) {
        expect(note.unitId).toBe("subj-p1:notes");
      }
    });
  });

  test("resolveNoteContent: returns mapped blocks", async () => {
    const config = { rootPageId: "root-page", depth: 3 as const };
    const content = await pageHierarchyStrategy.resolveNoteContent({
      config,
      notionClient: makeClient(),
      ref: { source: "notion", externalId: "note-p1", kind: "page" },
    });
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]).toMatchObject({ kind: "paragraph", text: "Some content" });
  });
});

// ---------------------------------------------------------------------------
// 4. notion.db-subjects-pages-units
// ---------------------------------------------------------------------------

describe("notion.db-subjects-pages-units", () => {
  const subjectPageWithMeta = {
    id: "s-db-1",
    last_edited_time: "2024-01-01T00:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: "Computer Science" }] },
      Course: { type: "select", select: { name: "CS101" } },
      Term: { type: "select", select: { name: "Spring 2024" } },
    },
  };

  const unitBlocks = [
    makeChildPageBlock("unit-db-1", "Algorithms"),
    makeChildPageBlock("unit-db-2", "Data Structures"),
  ];
  const noteBlocks = [makeChildPageBlock("note-db-1", "Big-O Notes")];
  const contentBlocks = [makeParagraphBlock("b-1", "Binary search explanation")];

  function makeClient(): NotionClient {
    return {
      fetch: mock(async (path: string) => {
        if (path.includes("/databases/subjects-db/query")) {
          return makeDbQueryResponse([subjectPageWithMeta]);
        }
        if (path.includes("/databases/subjects-db") && !path.includes("/query")) {
          return makeDbObject("subjects-db", "Subjects");
        }
        if (path.includes("/databases/") && !path.includes("/query")) {
          return makeDbObject("other-db", "Misc");
        }
        if (path.includes("/blocks/s-db-1/children")) {
          return makeBlockChildrenResponse(unitBlocks);
        }
        if (path.includes("/blocks/unit-db-1/children")) {
          return makeBlockChildrenResponse(noteBlocks);
        }
        if (path.includes("/blocks/note-db-1/children")) {
          return makeBlockChildrenResponse(contentBlocks);
        }
        return makeBlockChildrenResponse([]);
      }) as NotionClient["fetch"],
    };
  }

  const config = {
    subjectsDbId: "subjects-db",
    subjectNameProp: "Name",
    courseProperty: "Course",
    termProperty: "Term",
  };

  test("suggestConfig: title-matches /subjects?/ → sets subjectsDbId", async () => {
    // makeDbRefs uses the id as the title, so "subjects-db" title matches /subjects?/i.
    const databases = makeDbRefs(["subjects-db", "other-db"]);
    const client = makeClient();
    const cfg = await dbSubjectsPagesUnitsStrategy.suggestConfig({
      databases,
      pages: [],
      notionClient: client,
    });
    expect(cfg.subjectsDbId).toBe("subjects-db");
  });

  test("resolveSubjects: reads course and term from select props", async () => {
    const subjects = await dbSubjectsPagesUnitsStrategy.resolveSubjects({
      config,
      notionClient: makeClient(),
    });
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({
      id: "s-db-1",
      name: "Computer Science",
      course: "CS101",
      term: "Spring 2024",
    });
  });

  test("resolveUnits: child pages of subject page become units", async () => {
    const units = await dbSubjectsPagesUnitsStrategy.resolveUnits({
      config,
      notionClient: makeClient(),
      subjectId: "s-db-1",
    });
    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({ id: "unit-db-1", subjectId: "s-db-1", order: 0 });
  });

  test("resolveNotes: child pages of unit become notes", async () => {
    const notes = await dbSubjectsPagesUnitsStrategy.resolveNotes({
      config,
      notionClient: makeClient(),
      subjectId: "s-db-1",
      unitId: "unit-db-1",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      ref: { externalId: "note-db-1" },
      title: "Big-O Notes",
      unitId: "unit-db-1",
    });
  });

  test("resolveNoteContent: maps paragraph blocks", async () => {
    const content = await dbSubjectsPagesUnitsStrategy.resolveNoteContent({
      config,
      notionClient: makeClient(),
      ref: { source: "notion", externalId: "note-db-1", kind: "page" },
    });
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]!.text).toBe("Binary search explanation");
  });
});

// ---------------------------------------------------------------------------
// 5. notion.three-dbs
// ---------------------------------------------------------------------------

describe("notion.three-dbs", () => {
  const config = {
    subjectsDbId: "db-subj",
    unitsDbId: "db-unit",
    notesDbId: "db-note",
    subjectsNameProp: "Name",
    unitsNameProp: "Name",
    notesNameProp: "Name",
    unitToSubjectRelProperty: "Subject",
    noteToUnitRelProperty: "Unit",
  };

  const subjectPages = [makePage("subj-3d", "title", "History")];
  const unitPages = [makePage("unit-3d", "title", "Ancient Rome")];
  const notePages = [makePage("note-3d", "title", "The Republic")];
  const contentBlocks = [makeParagraphBlock("b-1", "Julius Caesar notes")];

  function makeClient(): NotionClient {
    return {
      fetch: mock(async (path: string) => {
        if (path.includes("/databases/db-subj/query")) {
          return makeDbQueryResponse(subjectPages);
        }
        if (path.includes("/databases/db-unit/query")) {
          return makeDbQueryResponse(unitPages);
        }
        if (path.includes("/databases/db-note/query")) {
          return makeDbQueryResponse(notePages);
        }
        // DB metadata for suggestConfig
        if (path === "/databases/db-subj") return makeDbObject("db-subj", "Subjects");
        if (path === "/databases/db-unit") return makeDbObject("db-unit", "Units");
        if (path === "/databases/db-note") return makeDbObject("db-note", "Notes");
        if (path.includes("/blocks/note-3d/children")) {
          return makeBlockChildrenResponse(contentBlocks);
        }
        return makeBlockChildrenResponse([]);
      }) as NotionClient["fetch"],
    };
  }

  test("suggestConfig: title-matches three DB heuristics", async () => {
    // Use descriptive titles so the heuristic regex can match.
    const databases: import("../types").NotionDatabaseRef[] = [
      { id: "db-subj", title: "Subjects", icon: null },
      { id: "db-unit", title: "Units", icon: null },
      { id: "db-note", title: "Notes", icon: null },
    ];
    const cfg = await threeDbsStrategy.suggestConfig({
      databases,
      pages: [],
      notionClient: makeClient(),
    });
    expect(cfg.subjectsDbId).toBe("db-subj");
    expect(cfg.unitsDbId).toBe("db-unit");
    expect(cfg.notesDbId).toBe("db-note");
  });

  test("resolveSubjects: queries subjects DB, returns correct shape", async () => {
    const subjects = await threeDbsStrategy.resolveSubjects({
      config,
      notionClient: makeClient(),
    });
    expect(subjects).toHaveLength(1);
    expect(subjects[0]).toMatchObject({ id: "subj-3d", name: "History" });
  });

  test("resolveUnits: queries units DB with subject relation filter", async () => {
    const units = await threeDbsStrategy.resolveUnits({
      config,
      notionClient: makeClient(),
      subjectId: "subj-3d",
    });
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      id: "unit-3d",
      subjectId: "subj-3d",
      order: 0,
      name: "Ancient Rome",
      sourceUnitRef: { source: "notion", externalId: "unit-3d" },
    });
  });

  test("resolveNotes: queries notes DB with unit relation filter", async () => {
    const notes = await threeDbsStrategy.resolveNotes({
      config,
      notionClient: makeClient(),
      subjectId: "subj-3d",
      unitId: "unit-3d",
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      ref: { source: "notion", externalId: "note-3d" },
      title: "The Republic",
      unitId: "unit-3d",
    });
  });

  test("resolveNoteContent: block children of note page are mapped", async () => {
    const content = await threeDbsStrategy.resolveNoteContent({
      config,
      notionClient: makeClient(),
      ref: { source: "notion", externalId: "note-3d", kind: "page" },
    });
    expect(content.blocks).toHaveLength(1);
    expect(content.blocks[0]).toMatchObject({ kind: "paragraph", text: "Julius Caesar notes" });
  });
});

// ---------------------------------------------------------------------------
// Shared: blocksToNoteBlocks helper (via strategy content resolution)
// ---------------------------------------------------------------------------

describe("blocksToNoteBlocks (via resolveNoteContent)", () => {
  const allBlockTypes = [
    { id: "h1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "H1 text" }] } },
    { id: "h2", type: "heading_2", heading_2: { rich_text: [{ plain_text: "H2 text" }] } },
    { id: "h3", type: "heading_3", heading_3: { rich_text: [{ plain_text: "H3 text" }] } },
    { id: "p1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Para" }] } },
    { id: "bl", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Bullet" }] } },
    { id: "nl", type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "Num" }] } },
    { id: "td", type: "to_do", to_do: { rich_text: [{ plain_text: "Todo" }] } },
    { id: "qt", type: "quote", quote: { rich_text: [{ plain_text: "Quote" }] } },
    { id: "cd", type: "code", code: { rich_text: [{ plain_text: "Code" }] } },
    // Binary blocks that should be skipped.
    { id: "img", type: "image" },
    { id: "vid", type: "video" },
    { id: "emb", type: "embed" },
    // Empty text should be skipped.
    { id: "emp", type: "paragraph", paragraph: { rich_text: [{ plain_text: "   " }] } },
    // Unknown textual type → paragraph fallback.
    { id: "unk", type: "callout", callout: { rich_text: [{ plain_text: "Callout" }] } },
  ];

  const client: NotionClient = {
    fetch: mock(async () =>
      makeBlockChildrenResponse(allBlockTypes),
    ) as NotionClient["fetch"],
  };

  test("maps known block types to correct BlockKind, skips binary and blank", async () => {
    const config = { rootPageId: "root", depth: 3 as const };
    const content = await pageHierarchyStrategy.resolveNoteContent({
      config,
      notionClient: client,
      ref: { source: "notion", externalId: "any-page", kind: "page" },
    });

    const kindMap: Record<string, string> = {};
    for (const b of content.blocks) {
      kindMap[b.text] = b.kind;
    }

    expect(kindMap["H1 text"]).toBe("heading");
    expect(kindMap["H2 text"]).toBe("heading");
    expect(kindMap["H3 text"]).toBe("heading");
    expect(kindMap["Para"]).toBe("paragraph");
    expect(kindMap["Bullet"]).toBe("bullet");
    expect(kindMap["Num"]).toBe("numbered");
    expect(kindMap["Todo"]).toBe("todo");
    expect(kindMap["Quote"]).toBe("quote");
    expect(kindMap["Code"]).toBe("code");
    // Unknown callout → paragraph fallback
    expect(kindMap["Callout"]).toBe("paragraph");

    // Binary blocks and blank text must be absent.
    expect(content.blocks.find((b) => b.text === "")).toBeUndefined();
    expect(content.blocks.find((b) => b.text.trim() === "")).toBeUndefined();
  });

  test("positions are sequential starting from 0", async () => {
    const config = { rootPageId: "root", depth: 3 as const };
    const content = await pageHierarchyStrategy.resolveNoteContent({
      config,
      notionClient: client,
      ref: { source: "notion", externalId: "any-page", kind: "page" },
    });
    for (let i = 0; i < content.blocks.length; i++) {
      expect(content.blocks[i]!.position).toBe(i);
    }
  });
});

// ---------------------------------------------------------------------------
// uiSchema field kind assertions (Phase 6 wizard UX)
// ---------------------------------------------------------------------------

describe("uiSchema field kinds", () => {
  test("notion.db-subjects-db-units: correct field kinds", () => {
    const schema = dbSubjectsDbUnitsStrategy.uiSchema;

    // DB pickers
    expect(schema["subjectsDbId"]?.kind).toBe("database");
    expect(schema["unitsDbId"]?.kind).toBe("database");

    // Property pickers with correct dependsOn
    const subjectNameProp = schema["subjectNameProp"];
    expect(subjectNameProp?.kind).toBe("property");
    if (subjectNameProp?.kind === "property") {
      expect(subjectNameProp.dependsOn).toBe("subjectsDbId");
      expect(subjectNameProp.propertyTypes).toContain("title");
      expect(subjectNameProp.default).toBe("Name");
    }

    const subjectRefPropOnUnit = schema["subjectRefPropOnUnit"];
    expect(subjectRefPropOnUnit?.kind).toBe("property");
    if (subjectRefPropOnUnit?.kind === "property") {
      expect(subjectRefPropOnUnit.dependsOn).toBe("unitsDbId");
      expect(subjectRefPropOnUnit.propertyTypes).toContain("relation");
    }

    // Optional property field is not required
    const unitRefPropOnNote = schema["unitRefPropOnNote"];
    expect(unitRefPropOnNote?.required).toBe(false);
  });

  test("notion.single-db-tagged: correct field kinds", () => {
    const schema = singleDbTaggedStrategy.uiSchema;

    expect(schema["databaseId"]?.kind).toBe("database");

    const typeProperty = schema["typeProperty"];
    expect(typeProperty?.kind).toBe("property");
    if (typeProperty?.kind === "property") {
      expect(typeProperty.dependsOn).toBe("databaseId");
      expect(typeProperty.propertyTypes).toContain("select");
      expect(typeProperty.propertyTypes).toContain("status");
    }

    const subjectTypeValue = schema["subjectTypeValue"];
    expect(subjectTypeValue?.kind).toBe("select-option");
    if (subjectTypeValue?.kind === "select-option") {
      expect(subjectTypeValue.dependsOnDatabase).toBe("databaseId");
      expect(subjectTypeValue.dependsOnProperty).toBe("typeProperty");
    }

    expect(schema["unitTypeValue"]?.kind).toBe("select-option");
    expect(schema["noteTypeValue"]?.kind).toBe("select-option");
  });

  test("notion.page-hierarchy: correct field kinds", () => {
    const schema = pageHierarchyStrategy.uiSchema;

    expect(schema["rootPageId"]?.kind).toBe("page");
    expect(schema["rootPageId"]?.required).toBe(true);

    const depth = schema["depth"];
    expect(depth?.kind).toBe("enum");
    if (depth?.kind === "enum") {
      expect(depth.options).toHaveLength(2);
      expect(depth.options[0]!.value).toBe("3");
      expect(depth.options[1]!.value).toBe("2");
      expect(depth.default).toBe("3");
    }
  });

  test("notion.db-subjects-pages-units: correct field kinds", () => {
    const schema = dbSubjectsPagesUnitsStrategy.uiSchema;

    expect(schema["subjectsDbId"]?.kind).toBe("database");
    expect(schema["subjectsDbId"]?.required).toBe(true);

    const subjectNameProp = schema["subjectNameProp"];
    expect(subjectNameProp?.kind).toBe("property");
    if (subjectNameProp?.kind === "property") {
      expect(subjectNameProp.dependsOn).toBe("subjectsDbId");
      expect(subjectNameProp.propertyTypes).toContain("title");
    }

    // Optional properties
    expect(schema["courseProperty"]?.required).toBe(false);
    expect(schema["termProperty"]?.required).toBe(false);
    expect(schema["glyphProperty"]?.required).toBe(false);
  });

  test("notion.three-dbs: correct field kinds", () => {
    const schema = threeDbsStrategy.uiSchema;

    expect(schema["subjectsDbId"]?.kind).toBe("database");
    expect(schema["unitsDbId"]?.kind).toBe("database");
    expect(schema["notesDbId"]?.kind).toBe("database");

    const unitToSubjectRelProperty = schema["unitToSubjectRelProperty"];
    expect(unitToSubjectRelProperty?.kind).toBe("property");
    if (unitToSubjectRelProperty?.kind === "property") {
      expect(unitToSubjectRelProperty.dependsOn).toBe("unitsDbId");
      expect(unitToSubjectRelProperty.propertyTypes).toContain("relation");
    }

    const noteToUnitRelProperty = schema["noteToUnitRelProperty"];
    expect(noteToUnitRelProperty?.kind).toBe("property");
    if (noteToUnitRelProperty?.kind === "property") {
      expect(noteToUnitRelProperty.dependsOn).toBe("notesDbId");
      expect(noteToUnitRelProperty.propertyTypes).toContain("relation");
    }
  });
});

// ---------------------------------------------------------------------------
// Shared: extractPageTitleFromProperties helper
// ---------------------------------------------------------------------------

import { extractPageTitleFromProperties } from "../_shared";

describe("extractPageTitleFromProperties helper", () => {
  test("reads the named title property", () => {
    const page = {
      id: "page-1",
      last_edited_time: "2024-01-01T00:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "My Page" }] },
      },
    };
    expect(extractPageTitleFromProperties(page as Parameters<typeof extractPageTitleFromProperties>[0], "Name")).toBe("My Page");
  });

  test("falls back to scanning for type=title when named prop missing", () => {
    const page = {
      id: "page-2",
      last_edited_time: "2024-01-01T00:00:00.000Z",
      properties: {
        Title: { type: "title", title: [{ plain_text: "Fallback Title" }] },
      },
    };
    // Pass a wrong prop name — should find the title-type prop via fallback.
    expect(extractPageTitleFromProperties(page as Parameters<typeof extractPageTitleFromProperties>[0], "Name")).toBe("Fallback Title");
  });

  test("returns page id when no title property found", () => {
    const page = {
      id: "page-3",
      last_edited_time: "2024-01-01T00:00:00.000Z",
      properties: {
        Status: { type: "select", select: { name: "Active" } },
      },
    };
    expect(extractPageTitleFromProperties(page as Parameters<typeof extractPageTitleFromProperties>[0], "Name")).toBe("page-3");
  });

  test("concatenates multi-segment rich_text title", () => {
    const page = {
      id: "page-4",
      last_edited_time: "2024-01-01T00:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Hello " }, { plain_text: "World" }] },
      },
    };
    expect(extractPageTitleFromProperties(page as Parameters<typeof extractPageTitleFromProperties>[0], "Name")).toBe("Hello World");
  });
});
