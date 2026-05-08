/**
 * Phase 3 eval gate (phase3-plan.md §10.1):
 *   - Verdict accuracy ≥ 0.85 vs. 200-tuple golden corpus (Bedrock only).
 *   - On Ollama: expect 0.50–0.70; do not block on it.
 *   - When corpus has < 200 tuples, log a warning and pass; enforce gate at ≥ 200.
 *   - Requires: apps/server/__eval__/verdicts.json (see shape below).
 *   - Self-skips if NOETICAI_EVAL_LIVE != "1".
 *
 * verdicts.json shape:
 * Array<{
 *   conceptId: string;
 *   fragmentId: string;
 *   expectedVerdict: "engages" | "mentions" | "tangential" | "off-topic";
 *   conceptName: string;
 *   conceptLearningObjective: string | null;
 *   fragmentText: string;
 * }>
 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { llm } from "../src/ai";
import { env } from "../src/env";
import { buildVerdictPrompt } from "../src/audit/prompt";
import { parseLlmJson } from "../src/ai/json";

const EVAL_DIR = import.meta.dir;
const VERDICTS_JSON = join(EVAL_DIR, "verdicts.json");

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const MIN_CORPUS_SIZE = 200;
const ACCURACY_GATE = 0.85;

const CorpusItemSchema = z.object({
  conceptId: z.string(),
  fragmentId: z.string(),
  expectedVerdict: z.enum(["engages", "mentions", "tangential", "off-topic"]),
  conceptName: z.string(),
  conceptLearningObjective: z.string().nullable(),
  fragmentText: z.string(),
});

const CorpusSchema = z.array(CorpusItemSchema);

const VerdictResponseSchema = z.array(
  z.object({
    id: z.string(),
    verdict: z.enum(["engages", "mentions", "tangential", "off-topic"]),
  }),
);

test("verdict accuracy gate", async () => {
  if (!LIVE) {
    console.log("[eval:verdicts] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (!existsSync(VERDICTS_JSON)) {
    console.log("[eval:verdicts] verdicts.json not found — skipping.");
    return;
  }

  const raw = readFileSync(VERDICTS_JSON, "utf-8");
  const corpus = CorpusSchema.parse(JSON.parse(raw));

  if (corpus.length < MIN_CORPUS_SIZE) {
    console.warn(
      `[eval:verdicts] corpus has ${corpus.length} tuples (< ${MIN_CORPUS_SIZE}). ` +
        `Accuracy gate not enforced. Add more tuples for the kill-criterion gate.`,
    );
    return;
  }

  let correct = 0;
  let total = 0;

  for (const item of corpus) {
    const { system, user } = buildVerdictPrompt({
      conceptName: item.conceptName,
      conceptLearningObjective: item.conceptLearningObjective,
      candidates: [{ id: item.fragmentId, text: item.fragmentText }],
    });

    const result = await llm.haiku({
      system,
      messages: [{ role: "user", content: [{ text: user }] }],
      maxTokens: 256,
      temperature: 0,
    });

    try {
      const verdicts = parseLlmJson(result.text, VerdictResponseSchema);
      const verdict = verdicts.find((v) => v.id === item.fragmentId);
      if (verdict?.verdict === item.expectedVerdict) {
        correct += 1;
      }
    } catch {
      // Parse failure counts as incorrect.
    }
    total += 1;
  }

  const accuracy = correct / total;
  const backend = env.NOETICAI_AI_BACKEND;

  console.log(
    `[eval:verdicts] backend=${backend} accuracy=${(accuracy * 100).toFixed(1)}% (${correct}/${total})`,
  );

  if (backend === "bedrock") {
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_GATE);
  } else {
    console.log(
      `[eval:verdicts] Ollama backend — accuracy gate (${ACCURACY_GATE}) not enforced.`,
    );
  }
});
