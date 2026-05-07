import { Hono } from "hono";
import { llm } from "../ai";
import { auth } from "../auth";

export const smokeLlmRouter = new Hono();

smokeLlmRouter.post("/dev/smoke-llm", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const result = await llm.sonnet({
    system: "Respond with a single short greeting (under 10 words).",
    messages: [{ role: "user", content: [{ text: "Say hello to NoeticAI." }] }],
    maxTokens: 64,
    temperature: 0.4,
  });

  return c.json({
    text: result.text,
    modelId: result.modelId,
    usage: result.usage,
  });
});
