// Shared helpers used across all Notion strategies.
// All functions are pure utilities — no side effects, no strategy-specific logic.

import type { NotionClient } from "./types";
import type { NoteBlock, BlockKind } from "@noeticai/connector-core";

// ---------------------------------------------------------------------------
// Notion wire-format types (internal — not exported)
// ---------------------------------------------------------------------------

export interface NotionRichText {
  plain_text: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  child_page?: { title: string };
  [key: string]: unknown;
}

export interface NotionBlocksResponse {
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface NotionProperty {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { name: string } | null;
  status?: { name: string } | null;
  relation?: Array<{ id: string }>;
  number?: number | null;
}

export interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
  last_edited_time: string;
  child_page?: { title: string };
}

export interface NotionDatabaseQueryResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, { type: string }>;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Concatenate all plain_text segments from a rich_text array. */
export function extractPlainText(richText?: NotionRichText[]): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((t) => t.plain_text).join("");
}

/** Read the human name of a database from its title array. */
export function extractDbTitle(db: NotionDatabase): string {
  return db.title.map((t) => t.plain_text).join("").trim() || db.id;
}

/**
 * Extract the page title from a page's properties.
 * Falls back to scanning all properties for one with type "title".
 */
export function extractPageTitleFromProperties(
  page: NotionPage,
  nameProp: string,
): string {
  const prop = page.properties[nameProp];
  if (prop) {
    if (prop.type === "title") return extractPlainText(prop.title);
    if (prop.type === "rich_text") return extractPlainText(prop.rich_text);
  }
  // Fallback: find any property of type "title"
  for (const p of Object.values(page.properties)) {
    if (p.type === "title" && p.title) return extractPlainText(p.title);
  }
  return page.id;
}

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/**
 * Paginate all rows from a Notion database query.
 * Optionally pass a filter body fragment (merged into each POST body).
 */
export async function paginateDb(
  client: NotionClient,
  dbId: string,
  filter?: Record<string, unknown>,
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const res = await client.fetch<NotionDatabaseQueryResponse>(
      `/databases/${dbId}/query`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    pages.push(...res.results);
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/**
 * Paginate all block children for a given block/page id.
 */
export async function paginateBlockChildren(
  client: NotionClient,
  blockId: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const qs = cursor
      ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : "?page_size=100";
    const res = await client.fetch<NotionBlocksResponse>(
      `/blocks/${blockId}/children${qs}`,
    );
    blocks.push(...res.results);
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);

  return blocks;
}

/**
 * List the immediate child pages of a page, returning id + title pairs.
 * Filters to blocks of type "child_page" only.
 */
export async function listChildPages(
  client: NotionClient,
  parentId: string,
): Promise<Array<{ id: string; title: string }>> {
  const blocks = await paginateBlockChildren(client, parentId);
  return blocks
    .filter((b) => b.type === "child_page")
    .map((b) => ({
      id: b.id,
      title: (b.child_page as { title: string } | undefined)?.title ?? b.id,
    }));
}

/**
 * Fetch a Notion page and extract its title property.
 * Falls back to the page id if no title property is found.
 */
export async function fetchPageTitle(
  client: NotionClient,
  pageId: string,
): Promise<string> {
  const page = await client.fetch<NotionPage>(`/pages/${pageId}`);
  return extractPageTitleFromProperties(page, "Name");
}

/**
 * Fetch a database object and extract its human-readable title.
 */
export async function fetchDbTitle(
  client: NotionClient,
  dbId: string,
): Promise<string> {
  const db = await client.fetch<NotionDatabase>(`/databases/${dbId}`);
  return extractDbTitle(db);
}

// ---------------------------------------------------------------------------
// Block → NoteBlock mapping
// ---------------------------------------------------------------------------

function notionBlockKind(notionType: string): BlockKind | null {
  switch (notionType) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "bulleted_list_item":
      return "bullet";
    case "numbered_list_item":
      return "numbered";
    case "to_do":
      return "todo";
    case "quote":
      return "quote";
    case "code":
      return "code";
    default:
      return null;
  }
}

function extractBlockText(block: NotionBlock): string {
  const content = block[block.type] as Record<string, unknown> | undefined;
  if (!content) return "";
  const richText = content["rich_text"] as NotionRichText[] | undefined;
  return extractPlainText(richText);
}

/**
 * Convert an array of raw Notion blocks to the internal NoteBlock format.
 * Skips binary/embed blocks and blank text. Unknown textual block types
 * are preserved as "paragraph" so content is never silently dropped.
 */
export function blocksToNoteBlocks(notionBlocks: NotionBlock[]): NoteBlock[] {
  const noteBlocks: NoteBlock[] = [];
  let position = 0;

  for (const block of notionBlocks) {
    if (
      block.type === "image" ||
      block.type === "embed" ||
      block.type === "file" ||
      block.type === "video" ||
      block.type === "audio" ||
      block.type === "pdf" ||
      block.type === "link_preview" ||
      block.type === "unsupported"
    ) {
      continue;
    }

    const kind = notionBlockKind(block.type);
    const text = extractBlockText(block);

    if (!text.trim()) continue;

    noteBlocks.push({
      kind: kind ?? "paragraph",
      text,
      position: position++,
    });
  }

  return noteBlocks;
}
