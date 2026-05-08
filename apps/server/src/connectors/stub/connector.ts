import type {
  Connector,
  Subject,
  Unit,
  NoteSummary,
  NoteContent,
  ResourceRef,
} from "@noeticai/connector-core";
import {
  getStubSubject,
  getStubUnits,
  listStubNoteSummaries,
  fetchStubNote,
} from "./fixtures";

// Phase 1 stub. Returns deterministic Spanish fixtures so the eval gate
// (retrieval recall ≥ 8/10) is reproducible.
//
// Subject + unit ids are derived per-user (sha256(userId + name)), matching
// the syllabus extraction path's id formula. This way a user who uploads an
// "Epistemología" syllabus AND runs the stub ingest converges on a single
// subject row — required for the audit pipeline to find both concepts and
// fragments under the same subject.
export const stubConnector: Connector = {
  source: "stub",

  async listSubjects({ userId }): Promise<Subject[]> {
    return [getStubSubject(userId)];
  },

  async listUnits({ userId, subjectId }): Promise<Unit[]> {
    const expected = getStubSubject(userId);
    if (subjectId !== expected.id) return [];
    return getStubUnits(userId);
  },

  async listNotes({ userId, subjectId, unitId }): Promise<NoteSummary[]> {
    const expected = getStubSubject(userId);
    if (subjectId !== expected.id) return [];
    const all = listStubNoteSummaries(userId);
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
