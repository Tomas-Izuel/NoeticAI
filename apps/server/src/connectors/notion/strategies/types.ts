import type { z } from "zod";
import type {
  ResourceRef,
  Subject,
  Unit,
  NoteSummary,
  NoteContent,
  StrategyDescriptor,
} from "@noeticai/connector-core";

// ---------------------------------------------------------------------------
// Notion property types supported in the UI schema
// ---------------------------------------------------------------------------

export type NotionPropertyType =
  | "title"
  | "rich_text"
  | "select"
  | "status"
  | "multi_select"
  | "relation"
  | "number"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone_number"
  | "formula"
  | "rollup"
  | "people"
  | "files"
  | "created_time"
  | "created_by"
  | "last_edited_time"
  | "last_edited_by";

// ---------------------------------------------------------------------------
// Discriminated union for the over-the-wire UI field descriptor.
// The web wizard reads this to render the appropriate picker without importing zod.
// ---------------------------------------------------------------------------

export type SerializedField =
  | {
      kind: "text";
      label: string;
      required: boolean;
      default?: string;
      help?: string;
    }
  | {
      kind: "database";
      label: string;
      required: boolean;
      help?: string;
    }
  | {
      kind: "page";
      label: string;
      required: boolean;
      help?: string;
    }
  | {
      kind: "property";
      label: string;
      required: boolean;
      /** Key of another field in the same uiSchema that resolves to a databaseId. */
      dependsOn: string;
      /** Only show properties of these types in the picker. */
      propertyTypes: NotionPropertyType[];
      default?: string;
      help?: string;
    }
  | {
      kind: "select-option";
      label: string;
      required: boolean;
      /** Field key in the same uiSchema that resolves to a databaseId. */
      dependsOnDatabase: string;
      /** Field key in the same uiSchema that resolves to a property name. */
      dependsOnProperty: string;
      default?: string;
      help?: string;
    }
  | {
      kind: "enum";
      label: string;
      required: boolean;
      options: { value: string; label: string; description?: string }[];
      default?: string;
      help?: string;
    };

export type SerializedConfigSchema = Record<string, SerializedField>;

// ---------------------------------------------------------------------------
// Rich resource refs returned by the discovery endpoint
// ---------------------------------------------------------------------------

export interface NotionIconRef {
  kind: "emoji" | "url";
  value: string;
}

export interface NotionDatabaseRef {
  id: string;
  title: string;
  icon: NotionIconRef | null;
}

export interface NotionPageRef {
  id: string;
  title: string;
  icon: NotionIconRef | null;
}

export interface NotionTopResourcesRich {
  databases: NotionDatabaseRef[];
  pages: NotionPageRef[];
}

// ---------------------------------------------------------------------------
// Notion property descriptor (schema endpoint response)
// ---------------------------------------------------------------------------

export interface PropertyDescriptor {
  name: string;
  type: NotionPropertyType;
}

// ---------------------------------------------------------------------------
// Notion client interface
// ---------------------------------------------------------------------------

export interface NotionClient {
  fetch<T>(path: string, init?: RequestInit): Promise<T>;
}

// ---------------------------------------------------------------------------
// Per-strategy interface
// ---------------------------------------------------------------------------

// Per-strategy interface. Every Notion strategy implements this so the
// connection router can dispatch discovery, validation, and resolution
// without knowing which concrete strategy is in use.
export interface NotionStrategy<TConfig = Record<string, unknown>> {
  key: string;
  descriptor: StrategyDescriptor;
  // zod schema for server-side config validation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema: z.ZodObject<any>;
  // Explicit UI field descriptors — served directly to the wizard.
  // The zod schema is for server-side validation only; the wizard reads uiSchema.
  uiSchema: SerializedConfigSchema;
  suggestConfig(args: {
    databases: NotionDatabaseRef[];
    pages: NotionPageRef[];
    notionClient: NotionClient;
  }): Promise<Partial<TConfig>>;
  resolveSubjects(args: { config: TConfig; notionClient: NotionClient }): Promise<Subject[]>;
  resolveUnits(args: {
    config: TConfig;
    notionClient: NotionClient;
    subjectId: string;
  }): Promise<Unit[]>;
  resolveNotes(args: {
    config: TConfig;
    notionClient: NotionClient;
    subjectId: string;
    unitId?: string;
  }): Promise<NoteSummary[]>;
  resolveNoteContent(args: {
    config: TConfig;
    notionClient: NotionClient;
    ref: ResourceRef;
  }): Promise<NoteContent>;
}
