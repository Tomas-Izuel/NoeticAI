import { Hono } from "hono";
import { auth } from "../auth";
import { pool } from "../db";
import { embed } from "../ai";

export const retrieveRouter = new Hono();

retrieveRouter.get("/dev/retrieve", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ error: "missing q" }, 400);
  const k = Math.min(Number(c.req.query("k") ?? 5), 20);

  // Use whatever model the active embed client defaults to (bge-m3 for
  // Ollama, amazon.titan-embed-text-v2:0 for Bedrock). The retrieved rows
  // are filtered by result.modelId so we only compare same-model vectors.
  const result = await embed.embed({
    texts: [q],
    inputType: "search_query",
  });
  const queryVec = result.vectors[0];
  if (!queryVec) return c.json({ error: "embed returned no vector" }, 500);
  const literal = `[${queryVec.join(",")}]`;

  // Cosine distance via pgvector. <=> is the cosine-distance operator
  // (smaller = more similar). Similarity = 1 - distance.
  const rows = await pool.query<{
    id: string;
    note_id: string;
    title: string;
    position: number;
    kind: string;
    text: string;
    distance: number;
  }>(
    `SELECT
       f.id,
       f.note_id,
       n.title,
       f.position,
       f.kind,
       f.text,
       (e.vector <=> $1::vector) AS distance
     FROM note_fragment_embeddings e
     JOIN note_fragments f ON f.id = e.fragment_id
     JOIN notes n ON n.id = f.note_id
     JOIN subjects s ON s.id = n.subject_id
     WHERE s.user_id = $2 AND e.model_id = $3
     ORDER BY e.vector <=> $1::vector
     LIMIT $4`,
    [literal, session.user.id, result.modelId, k],
  );

  return c.json({
    query: q,
    modelId: result.modelId,
    results: rows.rows.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      noteTitle: r.title,
      position: r.position,
      kind: r.kind,
      text: r.text,
      similarity: 1 - r.distance,
      distance: r.distance,
    })),
  });
});
