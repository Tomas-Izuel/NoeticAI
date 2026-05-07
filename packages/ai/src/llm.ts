import { converse } from "./bedrock";
import type { ConverseArgs, ConverseResult } from "./types";

export interface LlmConfig {
  opusId: string;
  sonnetId: string;
  haikuId: string;
}

export type TierArgs = Omit<ConverseArgs, "modelId">;

export interface Llm {
  opus(args: TierArgs): Promise<ConverseResult>;
  sonnet(args: TierArgs): Promise<ConverseResult>;
  haiku(args: TierArgs): Promise<ConverseResult>;
}

export function createLlm(cfg: LlmConfig): Llm {
  return {
    opus: (args) => converse({ ...args, modelId: cfg.opusId }),
    sonnet: (args) => converse({ ...args, modelId: cfg.sonnetId }),
    haiku: (args) => converse({ ...args, modelId: cfg.haikuId }),
  };
}
