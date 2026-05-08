import { Hono } from "hono";
import { createHash } from "node:crypto";
import { pool } from "../db";
import { auth } from "../auth";
import { embed } from "../ai";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@noeticai/audit-core";
import { enqueueAuditRun } from "../queue";
import { env } from "../env";

// Dev thresholds for the Ollama backend. bge-m3 produces lower absolute
// cosine scores than Cohere v3 — typical top-1 between unrelated-but-
// adjacent topics is ~0.45–0.55 vs. ~0.60–0.75 on Cohere. Without lowering,
// the audit returns all-red on dogfood data even when the pipeline is
// healthy. Production (Bedrock) keeps DEFAULT_THRESHOLDS verbatim.
//
// Tracked in prod-changes.md: re-run the eval gate on Bedrock to confirm
// the kill-criterion thresholds (0.85 verdict accuracy) hold under prod
// values, not these dev values.
const DEV_OLLAMA_THRESHOLDS: Thresholds = {
  greenDepth: 0.6,
  amberDepth: 0.4,
  minFragmentsForGreen: 2,
  conflictMinFragments: 3,
  hallucinationGuardSimilarity: 0.7,
};

function thresholdsForBackend(): Thresholds {
  return env.NOETICAI_AI_BACKEND === "ollama"
    ? DEV_OLLAMA_THRESHOLDS
    : DEFAULT_THRESHOLDS;
}

export const auditRouter = new Hono();

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// POST /api/audit/runs
// Body: { subjectId: string }
// ---------------------------------------------------------------------------

auditRouter.post("/api/audit/runs", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).subjectId !== "string"
  ) {
    return c.json({ error: "subjectId is required" }, 400);
  }

  const subjectId = (body as Record<string, unknown>).subjectId as string;

  // Ownership check.
  const subjectRows = await pool.query<{
    id: string;
    user_id: string;
  }>(
    `SELECT id, user_id FROM subjects WHERE id = $1`,
    [subjectId],
  );
  const subject = subjectRows.rows[0];
  if (!subject) return c.json({ error: "not found" }, 404);
  if (subject.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Look up the active syllabus.
  const syllabusRows = await pool.query<{ id: string }>(
    `SELECT id FROM syllabuses
     WHERE subject_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [subjectId],
  );
  const syllabusRow = syllabusRows.rows[0];
  if (!syllabusRow) {
    return c.json({ error: "no active syllabus for subject" }, 409);
  }
  const syllabusId = syllabusRow.id;

  // Generate content-addressed audit run id.
  const auditRunId = sha256Hex(
    subjectId + syllabusId + String(Date.now()),
  ).slice(0, 24);

  // Snapshot the model ids at enqueue time.
  const modelsJson = {
    embed: embed.defaultModelId,
    haiku:
      env.NOETICAI_AI_BACKEND === "ollama"
        ? `ollama:${env.NOETICAI_OLLAMA_LLM_MODEL}`
        : env.NOETICAI_BEDROCK_HAIKU_ID,
  };

  const thresholds = thresholdsForBackend();

  await pool.query(
    `INSERT INTO audit_runs (
       id, subject_id, syllabus_id, status, thresholds_json, models_json
     ) VALUES ($1, $2, $3, 'queued', $4, $5)`,
    [
      auditRunId,
      subjectId,
      syllabusId,
      JSON.stringify(thresholds),
      JSON.stringify(modelsJson),
    ],
  );

  const jobId = await enqueueAuditRun(
    { auditRunId },
    {
      attempts: 1,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  );

  return c.json({ auditRunId, jobId }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/audit/runs/:id
// Optional: ?conceptId=... narrows trace to a single concept (up to 20 frags)
// ---------------------------------------------------------------------------

auditRouter.get("/api/audit/runs/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const runId = c.req.param("id");
  const filterConceptId = c.req.query("conceptId") ?? null;

  // Ownership check via join.
  const runRows = await pool.query<{
    id: string;
    subject_id: string;
    syllabus_id: string;
    status: string;
    thresholds_json: unknown;
    models_json: unknown;
    failure_reason: string | null;
    started_at: Date;
    finished_at: Date | null;
    user_id: string;
  }>(
    `SELECT ar.id, ar.subject_id, ar.syllabus_id, ar.status,
            ar.thresholds_json, ar.models_json, ar.failure_reason,
            ar.started_at, ar.finished_at, s.user_id
     FROM audit_runs ar
     JOIN subjects s ON s.id = ar.subject_id
     WHERE ar.id = $1`,
    [runId],
  );

  const run = runRows.rows[0];
  if (!run) return c.json({ error: "not found" }, 404);
  if (run.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  const runShape = {
    id: run.id,
    subjectId: run.subject_id,
    syllabusId: run.syllabus_id,
    status: run.status as "queued" | "running" | "succeeded" | "failed",
    thresholds: run.thresholds_json,
    models: run.models_json,
    failureReason: run.failure_reason,
    startedAt: run.started_at.toISOString(),
    finishedAt: run.finished_at ? run.finished_at.toISOString() : null,
  };

  if (run.status !== "succeeded") {
    return c.json({ run: runShape });
  }

  // Pull mastery scores joined to concepts.
  // When filtering to a single concept, use parameterized $2 to avoid injection.
  const scoreRows = await pool.query<{
    concept_id: string;
    concept_name: string;
    unit_id: string | null;
    state: string;
    depth: string;
    mentions: number;
    sources: number;
    fragments: number;
    conflict: boolean;
  }>(
    filterConceptId
      ? `SELECT ms.concept_id, c.name AS concept_name, c.unit_id,
                ms.state, ms.depth, ms.mentions, ms.sources, ms.fragments, ms.conflict
         FROM mastery_scores ms
         JOIN concepts c ON c.id = ms.concept_id
         WHERE ms.audit_run_id = $1
           AND ms.concept_id = $2
         ORDER BY c.unit_id ASC, c."order" ASC`
      : `SELECT ms.concept_id, c.name AS concept_name, c.unit_id,
                ms.state, ms.depth, ms.mentions, ms.sources, ms.fragments, ms.conflict
         FROM mastery_scores ms
         JOIN concepts c ON c.id = ms.concept_id
         WHERE ms.audit_run_id = $1
         ORDER BY c.unit_id ASC, c."order" ASC`,
    filterConceptId ? [runId, filterConceptId] : [runId],
  );

  // Pull concept-fragment links with fragment + note metadata.
  // Per-concept top-5 (default) or top-20 (single concept filter).
  const traceLimit = filterConceptId ? 20 : 5;

  const traceConceptIds = scoreRows.rows.map((r) => r.concept_id);
  let traceRows: Array<{
    concept_id: string;
    fragment_id: string;
    fragment_text: string;
    note_id: string;
    note_title: string;
    similarity: string;
    verdict: string;
  }> = [];

  if (traceConceptIds.length > 0) {
    const traceRes = await pool.query<{
      concept_id: string;
      fragment_id: string;
      fragment_text: string;
      note_id: string;
      note_title: string;
      similarity: string;
      verdict: string;
    }>(
      `SELECT concept_id, fragment_id, fragment_text, note_id, note_title, similarity, verdict
       FROM (
         SELECT
           cfl.concept_id,
           cfl.fragment_id,
           nf.text AS fragment_text,
           n.id AS note_id,
           n.title AS note_title,
           cfl.similarity,
           cfl.verdict,
           ROW_NUMBER() OVER (
             PARTITION BY cfl.concept_id
             ORDER BY cfl.similarity DESC
           ) AS rk
         FROM concept_fragment_links cfl
         JOIN note_fragments nf ON nf.id = cfl.fragment_id
         JOIN notes n ON n.id = nf.note_id
         WHERE cfl.audit_run_id = $1
           AND cfl.concept_id = ANY($2::text[])
       ) ranked
       WHERE rk <= $3
       ORDER BY concept_id, similarity DESC`,
      [runId, traceConceptIds, traceLimit],
    );
    traceRows = traceRes.rows;
  }

  // Group trace rows by concept_id.
  const traceByConceptId = new Map<string, typeof traceRows>();
  for (const tr of traceRows) {
    const existing = traceByConceptId.get(tr.concept_id);
    if (existing) {
      existing.push(tr);
    } else {
      traceByConceptId.set(tr.concept_id, [tr]);
    }
  }

  const TRACE_PREVIEW_LEN = 320;

  const concepts = scoreRows.rows.map((s) => ({
    conceptId: s.concept_id,
    conceptName: s.concept_name,
    unitId: s.unit_id,
    state: s.state as "green" | "amber" | "red",
    depth: parseFloat(s.depth),
    mentions: s.mentions,
    sources: s.sources,
    fragments: s.fragments,
    conflict: s.conflict,
    trace: {
      topFragments: (traceByConceptId.get(s.concept_id) ?? []).map((t) => ({
        fragmentId: t.fragment_id,
        fragmentText:
          t.fragment_text.length > TRACE_PREVIEW_LEN
            ? `${t.fragment_text.slice(0, TRACE_PREVIEW_LEN)}…`
            : t.fragment_text,
        noteId: t.note_id,
        noteTitle: t.note_title,
        similarity: parseFloat(t.similarity),
        verdict: t.verdict as "engages" | "mentions" | "tangential" | "off-topic",
      })),
    },
  }));

  return c.json({ run: runShape, concepts });
});

// ---------------------------------------------------------------------------
// GET /api/subjects/:id/audit/latest
// ---------------------------------------------------------------------------

auditRouter.get("/api/subjects/:id/audit/latest", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const subjectId = c.req.param("id");

  // Ownership check.
  const subjectRows = await pool.query<{
    id: string;
    user_id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
  }>(
    `SELECT id, user_id, name, course, term, glyph
     FROM subjects WHERE id = $1`,
    [subjectId],
  );
  const subject = subjectRows.rows[0];
  if (!subject) return c.json({ error: "not found" }, 404);
  if (subject.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  const subjectShape = {
    id: subject.id,
    name: subject.name,
    course: subject.course,
    term: subject.term,
    glyph: subject.glyph,
  };

  // Find the latest succeeded run for this subject.
  const latestRunRows = await pool.query<{
    id: string;
    syllabus_id: string;
    started_at: Date;
    finished_at: Date;
  }>(
    `SELECT id, syllabus_id, started_at, finished_at
     FROM audit_runs
     WHERE subject_id = $1 AND status = 'succeeded'
     ORDER BY finished_at DESC LIMIT 1`,
    [subjectId],
  );
  const latestRun = latestRunRows.rows[0] ?? null;

  // Find the active syllabus for this subject.
  const activeSyllabusRows = await pool.query<{ id: string }>(
    `SELECT id FROM syllabuses WHERE subject_id = $1 AND is_active = TRUE LIMIT 1`,
    [subjectId],
  );
  const activeSyllabusId = activeSyllabusRows.rows[0]?.id ?? null;

  if (!activeSyllabusId) {
    // No active syllabus — return empty state.
    return c.json({
      run: null,
      subject: subjectShape,
      totals: null,
      units: [],
    });
  }

  // Pull units for the active syllabus's subject.
  const unitRows = await pool.query<{
    unit_id: string;
    unit_order: number;
    unit_name: string;
    weeks_label: string | null;
  }>(
    `SELECT u.id AS unit_id, u."order" AS unit_order, u.name AS unit_name, u.weeks_label
     FROM units u
     WHERE u.subject_id = $1
     ORDER BY u."order" ASC`,
    [subjectId],
  );

  // Pull concepts for the active syllabus (grouped by unit).
  const conceptRows = await pool.query<{
    concept_id: string;
    unit_id: string | null;
    concept_order: number;
    name: string;
    learning_objective: string | null;
  }>(
    `SELECT c.id AS concept_id, c.unit_id, c."order" AS concept_order,
            c.name, c.learning_objective
     FROM concepts c
     WHERE c.syllabus_id = $1
     ORDER BY c.unit_id ASC, c."order" ASC`,
    [activeSyllabusId],
  );

  if (!latestRun) {
    // No succeeded run yet — return concept skeleton with zeroed scores.
    const conceptsByUnit = new Map<string | null, typeof conceptRows.rows>();
    for (const cr of conceptRows.rows) {
      const key = cr.unit_id;
      const existing = conceptsByUnit.get(key);
      if (existing) {
        existing.push(cr);
      } else {
        conceptsByUnit.set(key, [cr]);
      }
    }

    const units = unitRows.rows.map((u) => ({
      id: u.unit_id,
      order: u.unit_order,
      name: u.unit_name,
      weeksLabel: u.weeks_label,
      concepts: (conceptsByUnit.get(u.unit_id) ?? []).map((c) => ({
        id: c.concept_id,
        order: c.concept_order,
        name: c.name,
        learningObjective: c.learning_objective,
        state: "red" as const,
        depth: 0,
        mentions: 0,
        sources: 0,
        fragments: 0,
        conflict: false,
        previews: [],
      })),
    }));

    return c.json({
      run: null,
      subject: subjectShape,
      totals: null,
      units,
    });
  }

  // Pull mastery scores for the latest run.
  const scoreRows = await pool.query<{
    concept_id: string;
    state: string;
    depth: string;
    mentions: number;
    sources: number;
    fragments: number;
    conflict: boolean;
  }>(
    `SELECT ms.concept_id, ms.state, ms.depth, ms.mentions, ms.sources,
            ms.fragments, ms.conflict
     FROM mastery_scores ms
     WHERE ms.audit_run_id = $1`,
    [latestRun.id],
  );

  const scoreMap = new Map(scoreRows.rows.map((s) => [s.concept_id, s]));

  // Pull top-3 previews per concept for the bundled drawer.
  const allConceptIds = conceptRows.rows.map((c) => c.concept_id);
  let previewRows: Array<{
    concept_id: string;
    fragment_id: string;
    fragment_text: string;
    similarity: string;
    verdict: string;
  }> = [];

  if (allConceptIds.length > 0) {
    const previewRes = await pool.query<{
      concept_id: string;
      fragment_id: string;
      fragment_text: string;
      similarity: string;
      verdict: string;
    }>(
      `SELECT concept_id, fragment_id, fragment_text, similarity, verdict
       FROM (
         SELECT
           cfl.concept_id,
           cfl.fragment_id,
           nf.text AS fragment_text,
           cfl.similarity,
           cfl.verdict,
           ROW_NUMBER() OVER (
             PARTITION BY cfl.concept_id
             ORDER BY cfl.similarity DESC
           ) AS rk
         FROM concept_fragment_links cfl
         JOIN note_fragments nf ON nf.id = cfl.fragment_id
         WHERE cfl.audit_run_id = $1
           AND cfl.concept_id = ANY($2::text[])
       ) ranked
       WHERE rk <= 3
       ORDER BY concept_id, similarity DESC`,
      [latestRun.id, allConceptIds],
    );
    previewRows = previewRes.rows;
  }

  const previewsByConceptId = new Map<string, typeof previewRows>();
  for (const pr of previewRows) {
    const existing = previewsByConceptId.get(pr.concept_id);
    if (existing) {
      existing.push(pr);
    } else {
      previewsByConceptId.set(pr.concept_id, [pr]);
    }
  }

  const PREVIEW_LEN = 200;

  // Group concepts by unit, merging scores.
  const conceptsByUnit = new Map<string | null, typeof conceptRows.rows>();
  for (const cr of conceptRows.rows) {
    const key = cr.unit_id;
    const existing = conceptsByUnit.get(key);
    if (existing) {
      existing.push(cr);
    } else {
      conceptsByUnit.set(key, [cr]);
    }
  }

  let totalConcepts = 0;
  let covered = 0;
  let partial = 0;
  let missing = 0;

  const units = unitRows.rows.map((u) => ({
    id: u.unit_id,
    order: u.unit_order,
    name: u.unit_name,
    weeksLabel: u.weeks_label,
    concepts: (conceptsByUnit.get(u.unit_id) ?? []).map((c) => {
      const score = scoreMap.get(c.concept_id);
      const state = (score?.state ?? "red") as "green" | "amber" | "red";

      totalConcepts += 1;
      if (state === "green") covered += 1;
      else if (state === "amber") partial += 1;
      else missing += 1;

      return {
        id: c.concept_id,
        order: c.concept_order,
        name: c.name,
        learningObjective: c.learning_objective,
        state,
        depth: score ? parseFloat(score.depth) : 0,
        mentions: score?.mentions ?? 0,
        sources: score?.sources ?? 0,
        fragments: score?.fragments ?? 0,
        conflict: score?.conflict ?? false,
        previews: (previewsByConceptId.get(c.concept_id) ?? []).map((p) => ({
          fragmentId: p.fragment_id,
          fragmentText:
            p.fragment_text.length > PREVIEW_LEN
              ? `${p.fragment_text.slice(0, PREVIEW_LEN)}…`
              : p.fragment_text,
          similarity: parseFloat(p.similarity),
          verdict: p.verdict as "engages" | "mentions" | "tangential" | "off-topic",
        })),
      };
    }),
  }));

  return c.json({
    run: {
      id: latestRun.id,
      startedAt: latestRun.started_at.toISOString(),
      finishedAt: latestRun.finished_at.toISOString(),
    },
    subject: subjectShape,
    totals: {
      concepts: totalConcepts,
      covered,
      partial,
      missing,
    },
    units,
  });
});
