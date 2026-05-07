import type {
  ResourceRef,
  NoteSummary,
  NoteContent,
  Subject,
  Unit,
} from "./types";

// A Connector is the read-only ingest interface for a knowledge source.
// Concrete implementations (StubConnector for fixtures, NotionConnector for
// real workspaces) live in apps/server/connectors/<source>/.
export interface Connector {
  readonly source: string; // e.g. "stub", "notion"

  // Discovery: list the user's top-level resources for the connect wizard.
  // Phase 1 doesn't use this; it lands when the wizard goes live in Phase 6.
  listTopLevelResources?(opts: { userId: string }): Promise<ResourceRef[]>;

  // Enumerate Subjects + Units the connector can see for this user.
  listSubjects(opts: { userId: string }): Promise<Subject[]>;
  listUnits(opts: { userId: string; subjectId: string }): Promise<Unit[]>;

  // Note-level surfaces. listNotes is metadata-only; fetchNote returns the
  // full body block list. Implementations cache fetchNote results in Redis
  // (Phase 6); the stub doesn't need to.
  listNotes(opts: {
    userId: string;
    subjectId: string;
    unitId?: string;
  }): Promise<NoteSummary[]>;
  fetchNote(opts: { userId: string; ref: ResourceRef }): Promise<NoteContent>;
}

export interface ConnectorRegistry {
  register(connector: Connector): void;
  get(source: string): Connector | undefined;
  all(): Connector[];
}

export function createConnectorRegistry(): ConnectorRegistry {
  const connectors = new Map<string, Connector>();
  return {
    register(c) {
      connectors.set(c.source, c);
    },
    get(source) {
      return connectors.get(source);
    },
    all() {
      return Array.from(connectors.values());
    },
  };
}
