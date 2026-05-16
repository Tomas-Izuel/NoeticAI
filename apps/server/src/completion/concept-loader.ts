import { pool } from "../db";

export interface ConceptOwnershipRow {
  id: string;
  syllabus_id: string;
  subject_id: string;
  user_id: string;
}

/**
 * Loads concept ownership data in a single JOIN query.
 * Returns null when the concept does not exist.
 * Callers must check user_id against the authenticated userId.
 */
export async function loadConceptForUser(
  conceptId: string,
): Promise<ConceptOwnershipRow | null> {
  const rows = await pool.query<ConceptOwnershipRow>(
    `SELECT c.id, c.syllabus_id, s.id AS subject_id, s.user_id
     FROM concepts c
     JOIN syllabuses sy ON sy.id = c.syllabus_id
     JOIN subjects s ON s.id = sy.subject_id
     WHERE c.id = $1`,
    [conceptId],
  );
  return rows.rows[0] ?? null;
}
