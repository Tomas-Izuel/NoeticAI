import type {
  Connector,
  Subject,
  Unit,
  NoteSummary,
  NoteContent,
  ResourceRef,
} from "@noeticai/connector-core";
import {
  stubSubject,
  stubUnits,
  listStubNoteSummaries,
  fetchStubNote,
} from "./fixtures";

// Phase 1 stub. Returns deterministic Spanish fixtures so the eval gate
// (retrieval recall ≥ 8/10) is reproducible. Listing-level methods ignore
// the userId — the stub is a single-user fixture.
export const stubConnector: Connector = {
  source: "stub",

  async listSubjects(): Promise<Subject[]> {
    return [stubSubject];
  },

  async listUnits({ subjectId }): Promise<Unit[]> {
    if (subjectId !== stubSubject.id) return [];
    return stubUnits;
  },

  async listNotes({ subjectId, unitId }): Promise<NoteSummary[]> {
    if (subjectId !== stubSubject.id) return [];
    const all = listStubNoteSummaries();
    return unitId ? all.filter((n) => n.unitId === unitId) : all;
  },

  async fetchNote({ ref }: { userId: string; ref: ResourceRef }): Promise<NoteContent> {
    if (ref.source !== "stub") {
      throw new Error(`stub connector cannot fetch ref from source=${ref.source}`);
    }
    const note = fetchStubNote(ref.externalId);
    if (!note) {
      throw new Error(`stub fixture not found: ${ref.externalId}`);
    }
    return note;
  },
};
