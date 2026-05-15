/**
 * Phase 5 eval gate — mean cost per completion < $0.05.
 *
 * Plan §8.3: reads the most recent 30 persisted completion rows whose
 * model_id matches a Bedrock Anthropic model (LIKE 'anthropic.%') and
 * computes mean cost using the Bedrock Sonnet pricing constants.
 *
 * Cost model (Bedrock Sonnet 4 us-east-1 rates as of implementation date):
 *   Fresh input:   $0.003 per 1K tokens
 *   Output:        $0.015 per 1K tokens
 *   Cache read:    $0.0003 per 1K tokens  (10x cheaper than fresh input)
 *   Cache write:   $0.00375 per 1K tokens
 *
 * These constants are duplicated from apps/web/src/lib/cost-rates.ts (the FE
 * cost badge). When AWS publishes rate changes, update both files. The canonical
 * source is the FE file; this file is the eval harness copy.
 *
 * This test does NOT generate new completions — it reads rows persisted by
 * citation-precision.test.ts (or any live completion run). Run
 * citation-precision.test.ts first to populate the completions table.
 *
 * Requirements:
 *   NOETICAI_EVAL_LIVE=1          — opt-in gate; self-skips without it.
 *   NOETICAI_AI_BACKEND=bedrock   — cost rates are Bedrock-specific;
 *                                   Ollama has no real token costs.
 */
import { test, expect } from "bun:test";
import { pool } from "../src/db";
import { env } from "../src/env";

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";
const COST_GATE_USD = 0.05;
const MIN_ROWS = 5; // require at least 5 rows before enforcing the gate

// Bedrock Sonnet 4 us-east-1 pricing (USD per 1K tokens).
// Canonical location: apps/web/src/lib/cost-rates.ts — keep in sync.
const SONNET_INPUT_USD_PER_1K = 0.003;
const SONNET_OUTPUT_USD_PER_1K = 0.015;
const SONNET_CACHE_READ_USD_PER_1K = 0.0003;
const SONNET_CACHE_WRITE_USD_PER_1K = 0.00375;

function computeCostUsd(row: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_write_input_tokens: number;
}): number {
  const freshInput =
    row.input_tokens - row.cache_read_input_tokens - row.cache_write_input_tokens;
  const freshCost = (Math.max(freshInput, 0) / 1000) * SONNET_INPUT_USD_PER_1K;
  const cacheReadCost = (row.cache_read_input_tokens / 1000) * SONNET_CACHE_READ_USD_PER_1K;
  const cacheWriteCost = (row.cache_write_input_tokens / 1000) * SONNET_CACHE_WRITE_USD_PER_1K;
  const outputCost = (row.output_tokens / 1000) * SONNET_OUTPUT_USD_PER_1K;
  return freshCost + cacheReadCost + cacheWriteCost + outputCost;
}

test("mean cost per completion < $0.05", async () => {
  if (!LIVE) {
    console.log("[eval:cost-per-completion] NOETICAI_EVAL_LIVE != 1 — skipping.");
    return;
  }

  if (env.NOETICAI_AI_BACKEND === "ollama") {
    console.log(
      "[eval:cost-per-completion] BEDROCK REQUIRED. " +
        "Current backend is ollama — token costs are not meaningful on Ollama. " +
        "Re-run with NOETICAI_AI_BACKEND=bedrock to validate the < $0.05 cost gate.",
    );
    return;
  }

  // Read the most recent 30 persisted completions from Bedrock Anthropic models.
  // These are expected to be rows produced by citation-precision.test.ts or a
  // live completion run against the fixture subject.
  const rows = await pool.query<{
    id: string;
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_write_input_tokens: number;
    status: string;
  }>(
    `SELECT id, model_id, input_tokens, output_tokens,
            cache_read_input_tokens, cache_write_input_tokens, status
     FROM completions
     WHERE model_id LIKE 'anthropic.%'
       AND status NOT IN ('queued', 'running', 'failed')
     ORDER BY created_at DESC
     LIMIT 30`,
  );

  if (rows.rows.length === 0) {
    console.log(
      "[eval:cost-per-completion] FIXTURE NOT YET POPULATED — no persisted completions found " +
        "with model_id LIKE 'anthropic.%'. " +
        "Run citation-precision.test.ts with NOETICAI_EVAL_LIVE=1 NOETICAI_AI_BACKEND=bedrock first " +
        "to populate the completions table.",
    );
    // Explicit skip — not a silent pass.
    expect(rows.rows.length).toBeGreaterThan(0);
    return;
  }

  if (rows.rows.length < MIN_ROWS) {
    console.warn(
      `[eval:cost-per-completion] only ${rows.rows.length} rows found (< ${MIN_ROWS} minimum). ` +
        `Run more completions to get a meaningful cost sample. Gate not enforced yet.`,
    );
    return;
  }

  let totalCost = 0;
  const costs: number[] = [];

  for (const row of rows.rows) {
    const cost = computeCostUsd(row);
    costs.push(cost);
    totalCost += cost;
    console.log(
      `[eval:cost-per-completion] id=${row.id} status=${row.status} model=${row.model_id} ` +
        `in=${row.input_tokens} out=${row.output_tokens} ` +
        `cacheRead=${row.cache_read_input_tokens} cacheWrite=${row.cache_write_input_tokens} ` +
        `cost=$${cost.toFixed(5)}`,
    );
  }

  const meanCost = totalCost / costs.length;
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  console.log(
    `[eval:cost-per-completion] backend=${env.NOETICAI_AI_BACKEND} ` +
      `n=${costs.length} mean=$${meanCost.toFixed(5)} ` +
      `min=$${minCost.toFixed(5)} max=$${maxCost.toFixed(5)}`,
  );

  expect(meanCost).toBeLessThanOrEqual(COST_GATE_USD);
});
