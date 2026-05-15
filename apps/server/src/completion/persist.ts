import { pool } from "../db";

export interface PersistCompletionArgs {
  completionId: string;
  summary: string;
  paragraphs: Array<{ text: string; sourceIds: string[] }>;
  confidence: number;
  modelId: string;
  embedModelId: string;
  promptHash: string;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  citations: Array<{
    paragraphIndex: number;
    chunkId: string;
    similarity: number;
  }>;
}

export interface PersistNullCompletionArgs {
  completionId: string;
  modelId: string;
  embedModelId: string;
  promptHash: string;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  guardFailureReason: string;
}

export interface PersistFailedCompletionArgs {
  completionId: string;
  failureReason: string;
}

/**
 * Persists a successful completion.
 *
 * Runs in a transaction:
 *  1. UPDATE completions row to status='pending' with all diagnostics.
 *  2. INSERT all citation rows.
 *
 * The completions row was pre-allocated with status='queued' by the router.
 */
export async function persistCompletion(args: PersistCompletionArgs): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE completions
       SET status = 'pending',
           summary = $2,
           paragraphs = $3,
           confidence = $4,
           model_id = $5,
           embed_model_id = $6,
           prompt_hash = $7,
           input_tokens = $8,
           output_tokens = $9,
           cache_read_input_tokens = $10,
           cache_write_input_tokens = $11,
           updated_at = NOW()
       WHERE id = $1`,
      [
        args.completionId,
        args.summary,
        JSON.stringify(args.paragraphs),
        args.confidence,
        args.modelId,
        args.embedModelId,
        args.promptHash,
        args.tokens.inputTokens,
        args.tokens.outputTokens,
        args.tokens.cacheReadInputTokens,
        args.tokens.cacheWriteInputTokens,
      ],
    );

    for (const citation of args.citations) {
      await client.query(
        `INSERT INTO citations (completion_id, paragraph_index, chunk_id, similarity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (completion_id, paragraph_index, chunk_id) DO UPDATE
           SET similarity = EXCLUDED.similarity`,
        [args.completionId, citation.paragraphIndex, citation.chunkId, citation.similarity],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Persists a null completion (hallucination guard returned ok: false, or zero chunks).
 *
 * Updates status to 'null_no_grounding' with the guard failure reason.
 * No citation rows are inserted.
 */
export async function persistNullCompletion(args: PersistNullCompletionArgs): Promise<void> {
  await pool.query(
    `UPDATE completions
     SET status = 'null_no_grounding',
         model_id = $2,
         embed_model_id = $3,
         prompt_hash = $4,
         input_tokens = $5,
         output_tokens = $6,
         cache_read_input_tokens = $7,
         cache_write_input_tokens = $8,
         guard_failure_reason = $9,
         updated_at = NOW()
     WHERE id = $1`,
    [
      args.completionId,
      args.modelId,
      args.embedModelId,
      args.promptHash,
      args.tokens.inputTokens,
      args.tokens.outputTokens,
      args.tokens.cacheReadInputTokens,
      args.tokens.cacheWriteInputTokens,
      args.guardFailureReason,
    ],
  );
}

/**
 * Persists a failed completion. Best-effort — should not throw or mask the
 * original error. Called from the catch block of processCompletionJob.
 */
export async function persistFailedCompletion(args: PersistFailedCompletionArgs): Promise<void> {
  await pool.query(
    `UPDATE completions
     SET status = 'failed',
         failure_reason = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [args.completionId, args.failureReason],
  );
}
