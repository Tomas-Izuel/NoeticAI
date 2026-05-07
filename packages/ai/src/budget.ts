import type { LlmTier, ConverseUsage } from "./types";

// Phase 0 stub. Phase 7g wires this to the cost_events table per plan.md §4.5.
export function recordUsage(opts: {
  tier: LlmTier;
  modelId: string;
  usage: ConverseUsage;
}): void {
  // eslint-disable-next-line no-console
  console.log(
    `[budget] tier=${opts.tier} model=${opts.modelId} in=${opts.usage.inputTokens} out=${opts.usage.outputTokens} cacheRead=${opts.usage.cacheReadInputTokens ?? 0} cacheWrite=${opts.usage.cacheWriteInputTokens ?? 0}`,
  );
}
