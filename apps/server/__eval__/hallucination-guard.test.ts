/**
 * Phase 5 eval gate — hallucination guard returns null 100% on 10-case fixture.
 *
 * Kill criterion (plan §8.2):
 *   For each case in hallucination-guard.json:
 *     - Load forcedChunkIds from source_chunks table.
 *     - Synthetically build RetrievedChunk[] from those chunk rows,
 *       bypassing natural retrieval entirely.
 *     - Build real completion prompt with the forced chunks.
 *     - Call llm.sonnet.
 *     - Run real hallucination guard with the forced chunks as retrievedChunks.
 *     - Assert guardResult.ok === false (the chunks deliberately do NOT cover
 *       the concept, so the guard MUST reject the LLM output).
 *
 *   Any case where the guard returns ok=true is a kill-criterion failure.
 *
 * Fixtures: apps/server/__eval__/hallucination-guard.json
 *
 * Requirements:
 *   NOETICAI_EVAL_LIVE=1          — opt-in gate; self-skips without it.
 *   NOETICAI_AI_BACKEND=bedrock   — Bedrock Sonnet required; kill criterion
 *                                   is not meaningful on Ollama/gemma4:e4b.
 *
 * Timeout: 600 000 ms (10 min) — 10 LLM + guard calls with re-embedding.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { pool } from "../src/db";
import { embed, llm } from "../src/ai";
import { env } from "../src/env";
import type { RetrievedChunk } from "../src/completion/retrieve";
import { buildCompletionPrompt } from "../src/completion/prompt";
import { runGuard } from "../src/completion/guard";

const EVAL_DIR = import.meta.dir;
const FIXTURE_PATH = join(EVAL_DIR, "hallucination-guard.json");

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";

const CaseSchema = z.object({
  conceptId: z.string(),
  forcedChunkIds: z.array(z.string()),
});

const FixtureSchema = z.object({
  _meta: z.object({
    phase: z.number(),
    totalCases: z.number(),
    passThreshold: z.number(),
  }),
  cases: z.array(CaseSchema),
});

test("hallucination guard returns null 100% on 10-case fixture", async () => {
  if (!LIVE) {
    console.log("[eval:hallucination-guard] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (env.NOETICAI_AI_BACKEND === "ollama") {
    console.log(
      "[eval:hallucination-guard] KILL-CRITERION GATE REQUIRES BEDROCK. " +
        "Current backend is ollama (model: gemma4:e4b). " +
        "Re-run with NOETICAI_AI_BACKEND=bedrock to validate the 100% null kill criterion.",
    );
    return;
  }

  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  const fixture = FixtureSchema.parse(JSON.parse(raw));

  if (fixture.cases.length === 0) {
    console.log(
      "[eval:hallucination-guard] FIXTURE NOT YET AUTHORED — hallucination-guard.json cases array is empty. " +
        "Hand-label 10 (conceptId, forcedChunkIds) cases where forcedChunkIds are real chunk ids " +
        "whose text is deliberately off-topic relative to the concept. " +
        "See plan §8.4 for the authoring approach. " +
        "The kill-criterion gate (100% null) cannot pass until this corpus is populated.",
    );
    // Explicit skip — not a silent pass.
    expect(fixture.cases.length).toBeGreaterThan(0);
    return;
  }

  for (let i = 0; i < fixture.cases.length; i++) {
    const evalCase = fixture.cases[i]!;

    // Load concept context for the prompt builder.
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
      [evalCase.conceptId],
    );

    const concept = conceptRows.rows[0];
    if (!concept) {
      throw new Error(
        `[eval:hallucination-guard] case ${i}: concept id=${evalCase.conceptId} not found in DB. ` +
          `Ensure the fixture DB is seeded.`,
      );
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
      throw new Error(
        `[eval:hallucination-guard] case ${i}: subject id=${concept.subject_id} not found.`,
      );
    }

    const syllabusRows = await pool.query<{
      version: number;
    }>(
      `SELECT version FROM syllabuses WHERE subject_id = $1 AND is_active = TRUE LIMIT 1`,
      [concept.subject_id],
    );
    const syllabus = syllabusRows.rows[0];
    if (!syllabus) {
      throw new Error(
        `[eval:hallucination-guard] case ${i}: no active syllabus for subject id=${concept.subject_id}.`,
      );
    }

    // Load forced chunks from DB (bypasses natural retrieval).
    const chunkRows = await pool.query<{
      id: string;
      source_id: string;
      source_title: string;
      source_author: string | null;
      source_year: number | null;
      position: number;
      chapter_label: string | null;
      pages_label: string | null;
      text: string;
    }>(
      `SELECT sc.id, sc.source_id, s.title AS source_title, s.author AS source_author,
              s.year AS source_year, sc.position, sc.chapter_label, sc.pages_label, sc.text
       FROM source_chunks sc
       JOIN sources s ON s.id = sc.source_id
       WHERE sc.id = ANY($1::text[])`,
      [evalCase.forcedChunkIds],
    );

    if (chunkRows.rows.length === 0) {
      throw new Error(
        `[eval:hallucination-guard] case ${i}: none of the forcedChunkIds were found in DB. ` +
          `chunkIds=${evalCase.forcedChunkIds.join(", ")}`,
      );
    }

    // Build synthetic RetrievedChunk[] — forced retrieval bypass.
    const forcedChunks: RetrievedChunk[] = chunkRows.rows.map((row) => ({
      chunkId: row.id,
      sourceId: row.source_id,
      sourceTitle: row.source_title,
      sourceAuthor: row.source_author,
      sourceYear: row.source_year,
      position: row.position,
      chapterLabel: row.chapter_label,
      pagesLabel: row.pages_label,
      text: row.text,
      retrievalSimilarity: 0, // synthetic — not from pgvector
    }));

    // Build real prompt with the forced chunks.
    let neighborhoodNames: string[] = [];
    if (concept.neighborhood && Array.isArray(concept.neighborhood)) {
      neighborhoodNames = (concept.neighborhood as Array<{ name?: string }>)
        .map((n) => n?.name ?? "")
        .filter((s) => s.length > 0)
        .slice(0, 5);
    }

    const thresholdsHash = "0.85";

    const promptOutput = buildCompletionPrompt({
      subjectId: concept.subject_id,
      subjectName: subject.name,
      subjectCourse: subject.course,
      syllabusExcerpt: concept.syllabus_excerpt ?? "",
      syllabusVersion: syllabus.version,
      thresholdsHash,
      conceptId: evalCase.conceptId,
      conceptUpdatedAtEpoch: concept.updated_at.getTime(),
      conceptName: concept.name,
      conceptLearningObjective: concept.learning_objective,
      neighborhoodNames,
      retrievedChunks: forcedChunks,
    });

    // Call real llm.sonnet.
    const result = await llm.sonnet({
      system: promptOutput.system,
      layeredContext: promptOutput.layeredContext,
      cachePoints: ["system", "subject", "concept"],
      maxTokens: 2048,
      temperature: 0.2,
      messages: [],
    });

    // Run real guard with the forced chunks as the retrieval context.
    const guardResult = await runGuard({
      llmOutput: result.text,
      retrievedChunks: forcedChunks,
      thresholds: {
        hallucinationGuardSimilarity: 0.85,
        minConfidence: 0.85,
      },
      embedClient: embed,
      embedModelId: embed.defaultModelId,
    });

    console.log(
      `[eval:hallucination-guard] case ${i} concept=${evalCase.conceptId} ` +
        `guard.ok=${guardResult.ok}` +
        (!guardResult.ok ? ` reason="${guardResult.reason}"` : ""),
    );

    // KILL CRITERION: the guard MUST return ok=false for every case.
    // These chunks deliberately do not cover the concept — any non-null result
    // means the guard is failing to catch a hallucination.
    expect(guardResult.ok, `KILL CRITERION FAILED: case ${i} concept=${evalCase.conceptId} returned non-null when chunks deliberately do not cover concept`).toBe(false);
  }

  console.log(
    `[eval:hallucination-guard] backend=${env.NOETICAI_AI_BACKEND} ` +
      `all ${fixture.cases.length} cases returned null (guard ok=false) — kill criterion PASSED.`,
  );
}, 600_000);
