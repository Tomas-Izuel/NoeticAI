import { Hono } from "hono";
import { auth } from "../auth";
import { pool } from "../db";

export const subjectsRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /api/subjects — list subjects for the authenticated user
// Frontend uses this for the subjectId fallback when no search-param is set.
// ---------------------------------------------------------------------------

subjectsRouter.get("/api/subjects", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const rows = await pool.query<{
    id: string;
    name: string;
    course: string | null;
  }>(
    `SELECT id, name, course FROM subjects WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );

  return c.json({
    subjects: rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      course: r.course,
    })),
  });
});
