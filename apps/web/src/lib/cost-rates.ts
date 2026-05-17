// Nova Lite us-east-1 rates as of 2026-05-17.
// Promote to a server-config endpoint when the cost_events table lands (Phase 7g).
// SONNET_* names are tier-role labels (sonnet = default completion tier);
// the underlying family is now Amazon Nova, not Anthropic Claude.
// Anthropic published distinct cache-read / cache-write rates; Nova bundles
// caching into the prompt-caching feature without breaking out per-1K cache
// rates the same way. We conservatively model cache-read/write at the fresh
// input rate until AWS publishes Nova-specific cache pricing. See plan.md §4.5.
export const SONNET_INPUT_USD_PER_1K = 0.00006;
export const SONNET_OUTPUT_USD_PER_1K = 0.00024;
export const SONNET_CACHE_READ_USD_PER_1K = 0.00006;   // model as input rate
export const SONNET_CACHE_WRITE_USD_PER_1K = 0.00006;  // model as input rate

export interface CompletionTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
}

/** Returns cost in US cents. */
export function computeCents(c: CompletionTokens): number {
  const freshInput =
    (c.inputTokens - c.cacheReadInputTokens - c.cacheWriteInputTokens) /
    1000 *
    SONNET_INPUT_USD_PER_1K;
  const cacheR = (c.cacheReadInputTokens / 1000) * SONNET_CACHE_READ_USD_PER_1K;
  const cacheW = (c.cacheWriteInputTokens / 1000) * SONNET_CACHE_WRITE_USD_PER_1K;
  const out = (c.outputTokens / 1000) * SONNET_OUTPUT_USD_PER_1K;
  return (freshInput + cacheR + cacheW + out) * 100;
}
