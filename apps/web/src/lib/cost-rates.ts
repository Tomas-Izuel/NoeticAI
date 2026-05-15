// Sonnet 4 us-east-1 rates as of Phase 5 implementation.
// Promote to a server-config endpoint when the cost_events table lands (Phase 7g).
export const SONNET_INPUT_USD_PER_1K = 0.003;
export const SONNET_OUTPUT_USD_PER_1K = 0.015;
export const SONNET_CACHE_READ_USD_PER_1K = 0.0003;
export const SONNET_CACHE_WRITE_USD_PER_1K = 0.00375;

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
