import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runMigrations } from "@noeticai/db";
import { env } from "./env";
import { pool } from "./db";
import { auth } from "./auth";
import { healthReport } from "./health";
import { startWorkers } from "./queue";
import { smokeLlmRouter } from "./dev/smoke-llm";
import { ingestRouter } from "./dev/ingest";
import { retrieveRouter } from "./dev/retrieve";
import { jobsRouter } from "./jobs";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    // env.WEB_URL is the canonical web origin (3000). 5173 = landing.
    origin: [env.WEB_URL, "http://localhost:5173"],
    credentials: true,
  }),
);

app.get("/", (c) => c.json({ name: "noeticai/server", ok: true }));

app.get("/health", async (c) => {
  const report = await healthReport();
  return c.json(report, report.status === "ok" ? 200 : 503);
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/api/me", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  return c.json({ user: session.user });
});

app.route("/", smokeLlmRouter);
app.route("/", ingestRouter);
app.route("/", retrieveRouter);
app.route("/", jobsRouter);

await runMigrations(pool);
startWorkers();

const port = env.PORT;

// eslint-disable-next-line no-console
console.log(`→ noeticai/server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
