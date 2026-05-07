// Phase 0 stubs — fields will fill in as later phases land.
// See plan.md §3.1 / §7 for the target shapes.

export type SourceType = "notion" | "drive" | "stub";

export interface ResourceRef {
  source: SourceType;
  externalId: string;
  kind: "page" | "database" | "block" | "file";
}

export interface Subject {
  id: string;
  name: string;
  course?: string;
  term?: string;
  glyph?: string;
  // TODO: notion_workspace, notion_root_page_id, syllabus_source_id
}

export interface Unit {
  id: string;
  subjectId: string;
  order: number;
  name: string;
  weeksLabel?: string;
  sourceUnitRef?: ResourceRef | null;
}

export interface NoteSummary {
  ref: ResourceRef;
  title: string;
  updatedAtExternal: string; // ISO
  unitId?: string | null;
}

export type BlockKind =
  | "heading"
  | "paragraph"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code";

export interface NoteBlock {
  kind: BlockKind;
  text: string;
  position: number;
}

export interface NoteContent {
  ref: ResourceRef;
  title: string;
  blocks: NoteBlock[];
}

export interface StrategyDescriptor {
  key: string; // e.g. "notion.db-subjects-db-units"
  source: SourceType;
  label: string;
  description: string;
  // configSchema is a serialized zod schema in the over-the-wire form.
  // Phase 6 wires this; for now it's a placeholder.
  configSchema: unknown;
}
