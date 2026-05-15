import { pool } from "../db";
import { embed, llm } from "../ai";
import { recordUsage } from "@noeticai/ai";
import { retrieveChunksForConcept } from "./retrieve";
import { buildCompletionPrompt } from "./prompt";
import { runGuard } from "./guard";
import {
  persistCompletion,
  persistNullCompletion,
  persistFailedCompletion,
} from "./persist";

export interface CompletionJobInput {
  completionId: string;
  conceptId: string;
  gapId: string;
  auditRunId: string;
  subjectId: string;
}

export interface CompletionJobResult {
  completionId: string;
  status: "succeeded" | "null_no_grounding" | "failed";
  guardFailureReason?: string;
  durationMs: number;
}

/**
 * Core completion orchestrator.
 *
 * Lifecycle:
 *   queued  -> running
 *   running -> succeeded         (guard passed, persistCompletion)
 *   running -> null_no_grounding (zero chunks or guard returned ok: false)
 *   running -> failed            (any thrown error, in processCompletionJob catch)
 */
export async function runCompletionJob(
  input: CompletionJobInput,
): Promise<CompletionJobResult> {
  const startedAt = performance.now();
  const { completionId, conceptId, auditRunId, subjectId } = input;

  // 1. Set status = 'running'.
  await pool.query(
    `UPDATE completions SET status = 'running', updated_at = NOW() WHERE id = $1`,
    [completionId],
  );

  // 2. Load subject, active syllabus, concept, thresholds.
  const subjectRows = await pool.query<{
    name: string;
    course: string | null;
  }>(
    `SELECT name, course FROM subjects WHERE id = $1`,
    [subjectId],
  );
  const subjectRow = subjectRows.rows[0];
  if (!subjectRow) throw new Error(`subject id=${subjectId} not found`);

  const syllabusRows = await pool.query<{
    id: string;
    version: number;
  }>(
    `SELECT id, version FROM syllabuses WHERE subject_id = $1 AND is_active = TRUE LIMIT 1`,
    [subjectId],
  );
  const syllabusRow = syllabusRows.rows[0];
  if (!syllabusRow) throw new Error(`no active syllabus for subject id=${subjectId}`);

  const conceptRows = await pool.query<{
    name: string;
    learning_objective: string | null;
    neighborhood: unknown;
    updated_at: Date;
    syllabus_excerpt: string | null;
  }>(
    `SELECT name, learning_objective, neighborhood, updated_at, syllabus_excerpt
     FROM concepts WHERE id = $1`,
    [conceptId],
  );
  const conceptRow = conceptRows.rows[0];
  if (!conceptRow) throw new Error(`concept id=${conceptId} not found`);

  const auditRows = await pool.query<{
    thresholds_json: {
      greenDepth: number;
      amberDepth: number;
      minFragmentsForGreen: number;
      conflictMinFragments: number;
      hallucinationGuardSimilarity: number;
    };
  }>(
    `SELECT thresholds_json FROM audit_runs WHERE id = $1`,
    [auditRunId],
  );
  const auditRow = auditRows.rows[0];
  if (!auditRow) throw new Error(`audit_run id=${auditRunId} not found`);

  const thresholds = auditRow.thresholds_json;
  const currentEmbedModelId = embed.defaultModelId;

  // 3. Retrieve source chunks.
  const chunks = await retrieveChunksForConcept({
    conceptId,
    subjectId,
    modelId: currentEmbedModelId,
  });

  // 4. Zero-chunks short-circuit.
  if (chunks.length === 0) {
    await persistNullCompletion({
      completionId,
      modelId: "n/a",
      embedModelId: currentEmbedModelId,
      promptHash: "",
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 },
      guardFailureReason: "no source chunks above similarity floor for this concept",
    });
    const durationMs = Math.round(performance.now() - startedAt);
    console.log(`[completion:job] id=${completionId} null_no_grounding (zero chunks) in ${durationMs}ms`);
    return { completionId, status: "null_no_grounding", durationMs };
  }

  // 5. Build prompt.
  let neighborhoodNames: string[] = [];
  if (conceptRow.neighborhood && Array.isArray(conceptRow.neighborhood)) {
    neighborhoodNames = (conceptRow.neighborhood as Array<{ name?: string }>)
      .map((n) => n?.name ?? "")
      .filter((s) => s.length > 0)
      .slice(0, 5);
  }

  // Derive thresholds hash from the snapshotted hallucinationGuardSimilarity
  // for the subject-layer cache key. We use the raw value as the hash for v1.
  const thresholdsHash = String(thresholds.hallucinationGuardSimilarity ?? 0.85);

  const promptOutput = buildCompletionPrompt({
    subjectId,
    subjectName: subjectRow.name,
    subjectCourse: subjectRow.course,
    syllabusExcerpt: conceptRow.syllabus_excerpt ?? "",
    syllabusVersion: syllabusRow.version,
    thresholdsHash,
    conceptId,
    conceptUpdatedAtEpoch: conceptRow.updated_at.getTime(),
    conceptName: conceptRow.name,
    conceptLearningObjective: conceptRow.learning_objective,
    neighborhoodNames,
    retrievedChunks: chunks,
  });

  // 6. Call real LLM (Sonnet) with layered context + cachePoints.
  const result = await llm.sonnet({
    system: promptOutput.system,
    layeredContext: promptOutput.layeredContext,
    cachePoints: ["system", "subject", "concept"],
    maxTokens: 2048,
    temperature: 0.2,
    messages: [],
  });

  const usageTokens = {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cacheReadInputTokens: result.usage.cacheReadInputTokens ?? 0,
    cacheWriteInputTokens: result.usage.cacheWriteInputTokens ?? 0,
  };

  // 7. Record usage for cost tracking.
  recordUsage({ tier: "sonnet", modelId: result.modelId, usage: result.usage });

  // 8. Run hallucination guard.
  const guardResult = await runGuard({
    llmOutput: result.text,
    retrievedChunks: chunks,
    thresholds: {
      hallucinationGuardSimilarity: thresholds.hallucinationGuardSimilarity ?? 0.85,
      minConfidence: 0.85,
    },
    embedClient: embed,
    embedModelId: currentEmbedModelId,
  });

  if (!guardResult.ok) {
    await persistNullCompletion({
      completionId,
      modelId: result.modelId,
      embedModelId: currentEmbedModelId,
      promptHash: promptOutput.promptHash,
      tokens: usageTokens,
      guardFailureReason: guardResult.reason,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    console.log(
      `[completion:job] id=${completionId} null_no_grounding (guard) reason="${guardResult.reason}" in ${durationMs}ms`,
    );
    return {
      completionId,
      status: "null_no_grounding",
      guardFailureReason: guardResult.reason,
      durationMs,
    };
  }

  // 9. Persist successful completion.
  const citations = guardResult.paragraphs.flatMap((paragraph, paragraphIndex) =>
    paragraph.sourceIds.map((chunkId) => ({
      paragraphIndex,
      chunkId,
      similarity: guardResult.citationSimilarities.get(`${paragraphIndex}:${chunkId}`) ?? 0,
    })),
  );

  await persistCompletion({
    completionId,
    summary: guardResult.summary,
    paragraphs: guardResult.paragraphs,
    confidence: guardResult.confidence,
    modelId: result.modelId,
    embedModelId: currentEmbedModelId,
    promptHash: promptOutput.promptHash,
    tokens: usageTokens,
    citations,
  });

  const durationMs = Math.round(performance.now() - startedAt);
  console.log(
    `[completion:job] id=${completionId} succeeded in ${durationMs}ms — ` +
      `tokens=${usageTokens.inputTokens}in/${usageTokens.outputTokens}out ` +
      `cacheRead=${usageTokens.cacheReadInputTokens} cacheWrite=${usageTokens.cacheWriteInputTokens}`,
  );

  return { completionId, status: "succeeded", durationMs };
}

/**
 * Wraps runCompletionJob; sets completions.status='failed' + failure_reason
 * on any thrown error before re-throwing.
 * Mirrors processAuditJob's try/catch pattern exactly.
 */
export async function processCompletionJob(
  input: CompletionJobInput,
): Promise<CompletionJobResult> {
  try {
    return await runCompletionJob(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await persistFailedCompletion({ completionId: input.completionId, failureReason: message });
    } catch {
      // ignore secondary failure — don't mask the original error
    }
    throw err;
  }
}
