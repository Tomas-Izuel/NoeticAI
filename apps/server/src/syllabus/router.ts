import { Hono } from "hono";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@noeticai/db";
import { db } from "../db";
import { auth } from "../auth";
import { storeSyllabusPdf } from "./storage";
import { enqueueSyllabusExtraction } from "../queue";

export const syllabusRouter = new Hono();

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Content-addressed subject id: sha256(userId + name).slice(0, 24). */
function makeSubjectId(userId: string, name: string): string {
  return sha256Hex(userId + name).slice(0, 24);
}

// ---------------------------------------------------------------------------
// POST /api/syllabus — upload a syllabus PDF
// ---------------------------------------------------------------------------

syllabusRouter.post("/api/syllabus", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  // Parse multipart form data.
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "expected multipart/form-data" }, 400);
  }

  const fileField = formData.get("file");
  if (!(fileField instanceof File)) {
    return c.json({ error: "missing file field" }, 400);
  }

  if (fileField.type !== "application/pdf") {
    return c.json({ error: "file must be application/pdf" }, 400);
  }

  const rawBytes = new Uint8Array(await fileField.arrayBuffer());
  if (rawBytes.length > MAX_PDF_BYTES) {
    return c.json({ error: "file exceeds 10 MB limit" }, 400);
  }

  const subjectNameField = formData.get("subjectName");
  const subjectName =
    typeof subjectNameField === "string" && subjectNameField.trim().length > 0
      ? subjectNameField.trim()
      : "Materia sin nombre";

  // Ensure the subject exists for this user.
  const sId = makeSubjectId(userId, subjectName);
  await db.execute(sql`
    INSERT INTO ${schema.subjects} (id, user_id, name, lang)
    VALUES (${sId}, ${userId}, ${subjectName}, 'es')
    ON CONFLICT (id) DO NOTHING
  `);

  // Determine the next version number.
  const versionRow = await db.execute<{ max_version: number | null }>(sql`
    SELECT MAX(version) AS max_version
    FROM ${schema.syllabuses}
    WHERE subject_id = ${sId}
  `);
  const prevMax = versionRow.rows[0]?.max_version ?? null;
  const version = prevMax !== null ? prevMax + 1 : 1;

  // Store the PDF on disk.
  const stored = await storeSyllabusPdf({
    bytes: rawBytes,
    originalFilename: fileField.name,
  });

  // Build a content-addressed syllabus id.
  const syllabusId = sha256Hex(
    sId + String(version) + String(Date.now()),
  ).slice(0, 24);

  await db.execute(sql`
    INSERT INTO ${schema.syllabuses} (
      id, subject_id, version, status,
      source_path, source_filename, is_active
    )
    VALUES (
      ${syllabusId},
      ${sId},
      ${version},
      'queued',
      ${stored.relativePath},
      ${stored.filename},
      FALSE
    )
  `);

  const jobId = await enqueueSyllabusExtraction({ syllabusId, userId });

  return c.json({ syllabusId, version, jobId }, 201);
});

// ---------------------------------------------------------------------------
// GET /api/curriculum/draft/:syllabusId
// ---------------------------------------------------------------------------

syllabusRouter.get("/api/curriculum/draft/:syllabusId", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const syllabusId = c.req.param("syllabusId");

  // Fetch syllabus + its subject in one query to verify ownership.
  const rows = await db.execute<{
    syllabus_id: string;
    subject_id: string;
    version: number;
    status: string;
    source_filename: string;
    page_count: number | null;
    is_active: boolean;
    failure_reason: string | null;
    created_at: Date;
    confirmed_at: Date | null;
    subject_name: string;
    subject_course: string | null;
    subject_term: string | null;
    subject_lang: string;
    user_id: string;
  }>(sql`
    SELECT
      s.id AS syllabus_id,
      s.subject_id,
      s.version,
      s.status,
      s.source_filename,
      s.page_count,
      s.is_active,
      s.failure_reason,
      s.created_at,
      s.confirmed_at,
      sub.name AS subject_name,
      sub.course AS subject_course,
      sub.term AS subject_term,
      sub.lang AS subject_lang,
      sub.user_id
    FROM ${schema.syllabuses} s
    JOIN ${schema.subjects} sub ON sub.id = s.subject_id
    WHERE s.id = ${syllabusId}
  `);

  const row = rows.rows[0];
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.user_id !== userId) return c.json({ error: "forbidden" }, 403);

  // Fetch units for this subject (a syllabus version shares units with the subject).
  const unitRows = await db.execute<{
    unit_id: string;
    unit_order: number;
    unit_name: string;
    weeks_label: string | null;
  }>(sql`
    SELECT
      u.id AS unit_id,
      u."order" AS unit_order,
      u.name AS unit_name,
      u.weeks_label
    FROM ${schema.units} u
    WHERE u.subject_id = ${row.subject_id}
    ORDER BY u."order" ASC
  `);

  // Fetch concepts for this specific syllabus version.
  const conceptRows = await db.execute<{
    concept_id: string;
    unit_id: string | null;
    concept_order: number;
    name: string;
    learning_objective: string | null;
    syllabus_excerpt: string | null;
  }>(sql`
    SELECT
      c.id AS concept_id,
      c.unit_id,
      c."order" AS concept_order,
      c.name,
      c.learning_objective,
      c.syllabus_excerpt
    FROM ${schema.concepts} c
    WHERE c.syllabus_id = ${syllabusId}
    ORDER BY c.unit_id ASC, c."order" ASC
  `);

  // Group concepts by unit_id.
  const conceptsByUnit = new Map<string | null, typeof conceptRows.rows>();
  for (const cr of conceptRows.rows) {
    const key = cr.unit_id ?? null;
    const existing = conceptsByUnit.get(key);
    if (existing) {
      existing.push(cr);
    } else {
      conceptsByUnit.set(key, [cr]);
    }
  }

  const unitsWithConcepts = unitRows.rows.map((u) => ({
    id: u.unit_id,
    order: u.unit_order,
    name: u.unit_name,
    weeksLabel: u.weeks_label,
    concepts: (conceptsByUnit.get(u.unit_id) ?? []).map((c) => ({
      id: c.concept_id,
      order: c.concept_order,
      name: c.name,
      learningObjective: c.learning_objective,
      syllabusExcerpt: c.syllabus_excerpt,
    })),
  }));

  return c.json({
    syllabus: {
      id: row.syllabus_id,
      subjectId: row.subject_id,
      version: row.version,
      status: row.status,
      sourceFilename: row.source_filename,
      pageCount: row.page_count,
      isActive: row.is_active,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    },
    subject: {
      id: row.subject_id,
      name: row.subject_name,
      course: row.subject_course,
      term: row.subject_term,
      lang: row.subject_lang,
    },
    units: unitsWithConcepts,
  });
});

// ---------------------------------------------------------------------------
// POST /api/curriculum/confirm
// ---------------------------------------------------------------------------

const ConfirmBodySchema = z.object({
  syllabusId: z.string().min(1),
  edits: z
    .object({
      subject: z
        .object({
          name: z.string().optional(),
        })
        .optional(),
      units: z.record(z.object({ name: z.string().optional() })).optional(),
      concepts: z
        .record(
          z.object({
            name: z.string().optional(),
            learningObjective: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

syllabusRouter.post("/api/curriculum/confirm", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const parsed = ConfirmBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid request", issues: parsed.error.issues }, 400);
  }
  const { syllabusId, edits } = parsed.data;

  // Ownership check.
  const ownerRows = await db.execute<{
    subject_id: string;
    user_id: string;
    status: string;
    version: number;
  }>(sql`
    SELECT s.subject_id, sub.user_id, s.status, s.version
    FROM ${schema.syllabuses} s
    JOIN ${schema.subjects} sub ON sub.id = s.subject_id
    WHERE s.id = ${syllabusId}
  `);
  const owner = ownerRows.rows[0];
  if (!owner) return c.json({ error: "not found" }, 404);
  if (owner.user_id !== userId) return c.json({ error: "forbidden" }, 403);
  if (owner.status !== "ready") {
    return c.json(
      { error: `cannot confirm a syllabus in status=${owner.status}` },
      409,
    );
  }
  const subjectId = owner.subject_id;
  const version = owner.version;

  // Apply edits before activating.
  if (edits?.subject?.name) {
    await db.execute(sql`
      UPDATE ${schema.subjects}
      SET name = ${edits.subject.name}, updated_at = NOW()
      WHERE id = ${subjectId}
    `);
  }

  if (edits?.units) {
    for (const [unitId, unitEdit] of Object.entries(edits.units)) {
      if (unitEdit.name) {
        await db.execute(sql`
          UPDATE ${schema.units}
          SET name = ${unitEdit.name}
          WHERE id = ${unitId} AND subject_id = ${subjectId}
        `);
      }
    }
  }

  if (edits?.concepts) {
    for (const [conceptId, conceptEdit] of Object.entries(edits.concepts)) {
      const hasName = typeof conceptEdit.name === "string";
      const hasLo = typeof conceptEdit.learningObjective === "string";
      if (!hasName && !hasLo) continue;

      if (hasName && hasLo) {
        await db.execute(sql`
          UPDATE ${schema.concepts}
          SET name = ${conceptEdit.name ?? null},
              learning_objective = ${conceptEdit.learningObjective ?? null},
              updated_at = NOW()
          WHERE id = ${conceptId} AND syllabus_id = ${syllabusId}
        `);
      } else if (hasName) {
        await db.execute(sql`
          UPDATE ${schema.concepts}
          SET name = ${conceptEdit.name ?? null}, updated_at = NOW()
          WHERE id = ${conceptId} AND syllabus_id = ${syllabusId}
        `);
      } else {
        await db.execute(sql`
          UPDATE ${schema.concepts}
          SET learning_objective = ${conceptEdit.learningObjective ?? null}, updated_at = NOW()
          WHERE id = ${conceptId} AND syllabus_id = ${syllabusId}
        `);
      }
    }
  }

  // Activate this syllabus version atomically.
  await db.execute(sql`
    UPDATE ${schema.syllabuses}
    SET is_active = FALSE
    WHERE subject_id = ${subjectId} AND is_active = TRUE
  `);
  await db.execute(sql`
    UPDATE ${schema.syllabuses}
    SET is_active = TRUE, status = 'confirmed', confirmed_at = NOW()
    WHERE id = ${syllabusId}
  `);

  return c.json({ subjectId, syllabusId, version }, 200);
});
