export type LlmTier = "opus" | "sonnet" | "haiku";

export type ConverseRole = "user" | "assistant";

export interface ConverseMessage {
  role: ConverseRole;
  content: Array<{ text: string }>;
}

export interface ConverseArgs {
  modelId: string;
  system?: string;
  messages: ConverseMessage[];
  // Layered cache markers — Phase 5 wires these into the Bedrock request body.
  // Phase 0 accepts the param so call sites are forward-compatible.
  cachePoints?: Array<"system" | "subject" | "concept">;
  maxTokens?: number;
  temperature?: number;
}

export interface ConverseUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
}

export interface ConverseResult {
  text: string;
  modelId: string;
  usage: ConverseUsage;
  stopReason?: string;
}

export interface EmbedArgs {
  texts: string[];
  modelId?: string;
  inputType?: "search_document" | "search_query";
}

export interface EmbedResult {
  modelId: string;
  dim: number;
  vectors: number[][];
}
