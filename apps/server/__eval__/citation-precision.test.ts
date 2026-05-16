/**
 * Phase 5 eval gate — citation precision ≥ 0.95 on 30-tuple golden corpus.
 *
 * Kill criterion (plan §8.1):
 *   For each (conceptId, expectedCitationChunkIds) tuple in citations.json:
 *     - Run real retrieveChunksForConcept.
 *     - Build real completion prompt.
 *     - Call llm.sonnet with cachePoints.
 *     - Run real hallucination guard.
 *     - If guard returned ok=false → precision for this tuple = 0 (penalises
 *       false negatives, i.e. cases where the model returns null when it
 *       should have cited something).
 *     - If guard returned ok=true → precision = |cited ∩ expected| / |cited|.
 *   Assert mean precision ≥ 0.95 across all 30 tuples.
 *
 * Fixtures: apps/server/__eval__/citations.json
 *
 * Requirements:
 *   NOETICAI_EVAL_LIVE=1   — opt-in gate; self-skips without it.
 *   NOETICAI_AI_BACKEND=bedrock — kill criterion is Bedrock-only; Ollama
 *                                  uses a different model (gemma4:e4b) and
 *                                  the 0.95 gate is not meaningful on it.
 *
 * Timeout: 600 000 ms (10 min) — 30 sequential LLM calls.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { pool } from "../src/db";
import { embed, llm } from "../src/ai";
import { env } from "../src/env";
import { retrieveChunksForConcept } from "../src/completion/retrieve";
import { buildCompletionPrompt } from "../src/completion/prompt";
import { runGuard } from "../src/completion/guard";

const EVAL_DIR = import.meta.dir;
const FIXTURE_PATH = join(EVAL_DIR, "citations.json");

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const PRECISION_GATE = 0.95;

const TupleSchema = z.object({
  conceptId: z.string(),
  conceptName: z.string().optional(),
  expectedCitationChunkIds: z.array(z.string()),
});

const FixtureSchema = z.object({
  _meta: z.object({
    phase: z.number(),
    totalTuples: z.number(),
    precisionGate: z.number(),
  }),
  tuples: z.array(TupleSchema),
});

test("citation precision ≥ 0.95 on 30-tuple golden corpus", async () => {
  if (!LIVE) {
    console.log("[eval:citation-precision] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (env.NOETICAI_AI_BACKEND === "ollama") {
    console.log(
      "[eval:citation-precision] KILL-CRITERION GATE REQUIRES BEDROCK. " +
        "Current backend is ollama (model: gemma4:e4b). " +
        "Re-run with NOETICAI_AI_BACKEND=bedrock to validate the ≥ 0.95 citation precision gate.",
    );
    return;
  }

  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  const fixture = FixtureSchema.parse(JSON.parse(raw));

  if (fixture.tuples.length === 0) {
    console.log(
      "[eval:citation-precision] FIXTURE NOT YET AUTHORED — citations.json tuples array is empty. " +
        "Hand-label 30 (conceptId, expectedCitationChunkIds) tuples against source-fixture.pdf. " +
        "See plan §8.4 for the authoring approach. " +
        "The kill-criterion gate (≥ 0.95 citation precision) cannot pass until this corpus is populated.",
    );
    // Explicit skip — not a silent pass.
    expect(fixture.tuples.length).toBeGreaterThan(0);
    return;
  }

  const precisions: number[] = [];

  for (const tuple of fixture.tuples) {
    // Load the concept's subject and audit context so we can build the full prompt.
    const conceptRows = await pool.query<{
      name: string;
      learning_objective: string | null;
      neighborhood: unknown;
      updated_at: Date;
      syllabus_excerpt: string | null;
      subject_id: string;
    }>(
      `SELECT c.name, c.learning_objective, c.neighborhood, c.updated_at,
              c.syllabus_excerpt, s.id AS subject_id
       FROM concepts c
       JOIN syllabuses sy ON sy.id = c.syllabus_id
       JOIN subjects s ON s.id = sy.subject_id
       WHERE c.id = $1`,
      [tuple.conceptId],
    );

    const concept = conceptRows.rows[0];
    if (!concept) {
      console.warn(
        `[eval:citation-precision] concept id=${tuple.conceptId} not found in DB — skipping tuple.`,
      );
      precisions.push(0);
      continue;
    }

    const subjectRows = await pool.query<{
      name: string;
      course: string | null;
    }>(
      `SELECT name, course FROM subjects WHERE id = $1`,
      [concept.subject_id],
    );
    const subject = subjectRows.rows[0];
    if (!subject) {
      console.warn(
        `[eval:citation-precision] subject id=${concept.subject_id} not found — skipping tuple.`,
      );
      precisions.push(0);
      continue;
    }

    const syllabusRows = await pool.query<{
      version: number;
    }>(
      `SELECT version FROM syllabuses WHERE subject_id = $1 AND is_active = TRUE LIMIT 1`,
      [concept.subject_id],
    );
    const syllabus = syllabusRows.rows[0];
    if (!syllabus) {
      console.warn(
        `[eval:citation-precision] no active syllabus for subject id=${concept.subject_id} — skipping tuple.`,
      );
      precisions.push(0);
      continue;
    }

    // Step 1: retrieve chunks (real retrieval).
    const retrieveResult = await retrieveChunksForConcept({
      conceptId: tuple.conceptId,
      subjectId: concept.subject_id,
      modelId: embed.defaultModelId,
    });
    const chunks = retrieveResult.chunks;

    if (chunks.length === 0) {
      console.warn(
        `[eval:citation-precision] concept=${tuple.conceptId} — zero chunks retrieved (no sources above similarity floor).`,
      );
      precisions.push(0);
      continue;
    }

    // Step 2: build prompt.
    let neighborhoodNames: string[] = [];
    if (concept.neighborhood && Array.isArray(concept.neighborhood)) {
      neighborhoodNames = (concept.neighborhood as Array<{ name?: string }>)
        .map((n) => n?.name ?? "")
        .filter((s) => s.length > 0)
        .slice(0, 5);
    }

    const thresholdsHash = "0.85"; // default hallucinationGuardSimilarity

    const promptOutput = buildCompletionPrompt({
      subjectId: concept.subject_id,
      subjectName: subject.name,
      subjectCourse: subject.course,
      syllabusExcerpt: concept.syllabus_excerpt ?? "",
      syllabusVersion: syllabus.version,
      thresholdsHash,
      conceptId: tuple.conceptId,
      conceptUpdatedAtEpoch: concept.updated_at.getTime(),
      conceptName: concept.name,
      conceptLearningObjective: concept.learning_objective,
      neighborhoodNames,
      retrievedChunks: chunks,
    });

    // Step 3: call real llm.sonnet.
    const result = await llm.sonnet({
      system: promptOutput.system,
      layeredContext: promptOutput.layeredContext,
      cachePoints: ["system", "subject", "concept"],
      maxTokens: 2048,
      temperature: 0.2,
      messages: [],
    });

    // Step 4: run real guard.
    const guardResult = await runGuard({
      llmOutput: result.text,
      retrievedChunks: chunks,
      thresholds: {
        hallucinationGuardSimilarity: 0.85,
        minConfidence: 0.85,
      },
      embedClient: embed,
      embedModelId: embed.defaultModelId,
    });

    if (!guardResult.ok) {
      // Guard returned null — count as precision=0 for this tuple.
      console.log(
        `[eval:citation-precision] concept=${tuple.conceptId} guard=null reason="${guardResult.reason}"`,
      );
      precisions.push(0);
      continue;
    }

    // Compute precision = |cited ∩ expected| / |cited|.
    const cited = new Set(
      guardResult.paragraphs.flatMap((p) => p.sourceIds),
    );
    const expected = new Set(tuple.expectedCitationChunkIds);

    if (cited.size === 0) {
      console.warn(
        `[eval:citation-precision] concept=${tuple.conceptId} guard=ok but cited set is empty.`,
      );
      precisions.push(0);
      continue;
    }

    const intersection = [...cited].filter((id) => expected.has(id)).length;
    const precision = intersection / cited.size;

    console.log(
      `[eval:citation-precision] concept=${tuple.conceptId} ` +
        `cited=${cited.size} expected=${expected.size} intersection=${intersection} ` +
        `precision=${precision.toFixed(3)}`,
    );

    precisions.push(precision);
  }

  const meanPrecision =
    precisions.length > 0
      ? precisions.reduce((sum, p) => sum + p, 0) / precisions.length
      : 0;

  console.log(
    `[eval:citation-precision] backend=${env.NOETICAI_AI_BACKEND} ` +
      `mean precision=${(meanPrecision * 100).toFixed(1)}% over ${precisions.length} tuples`,
  );

  expect(meanPrecision).toBeGreaterThanOrEqual(PRECISION_GATE);
}, 600_000);
