import { Hono } from "hono";
import { auth } from "./auth";
import { lookupJob } from "./queue";

export const jobsRouter = new Hono();

jobsRouter.get("/api/jobs/:id", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const job = await lookupJob(c.req.param("id"));
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json(job);
});
