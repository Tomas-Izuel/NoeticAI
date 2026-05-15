export type LlmTier = "opus" | "sonnet" | "haiku";

export type ConverseRole = "user" | "assistant";

export interface ConverseMessage {
  role: ConverseRole;
  content: Array<{ text: string }>;
}

/** Named cache layers, in stable-to-volatile order. */
export type CacheLayer = "system" | "subject" | "concept";

/**
 * Phase 5 layered context.
 * Drives cachePoint placement in the Bedrock Converse request:
 *   subject → cached per syllabus version
 *   concept → cached per concept edit
 *   userTurn → never cached (contains retrieved chunks + task)
 */
export interface LayeredContext {
  subject?: string;   // subject-cached prefix
  concept?: string;   // concept-cached prefix
  userTurn?: string;  // never cached — chunks + user task
}

export interface ConverseArgs {
  modelId: string;
  system?: string;
  messages: ConverseMessage[];
  // Layered cache markers — Phase 5 wires these into the Bedrock request body.
  cachePoints?: CacheLayer[];
  layeredContext?: LayeredContext;   // NEW Phase 5 — drives cachePoint placement
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
