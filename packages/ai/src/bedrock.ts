import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type SystemContentBlock,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { ConverseArgs, ConverseResult, CacheLayer } from "./types";

let _client: BedrockRuntimeClient | null = null;

export function getBedrockClient(region?: string): BedrockRuntimeClient {
  if (_client) return _client;
  _client = new BedrockRuntimeClient({
    region: region ?? process.env.AWS_REGION ?? "us-east-1",
  });
  return _client;
}

const CACHE_POINT_BLOCK = { cachePoint: { type: "default" as const } };

/**
 * Phase 5: cachePoint wiring.
 *
 * The `cachePoints` arg is an ordered list of layers to emit cachePoint markers
 * for: ["system", "subject", "concept"]. The marker means "everything in this
 * array up to and including the previous text block is part of a cache prefix."
 *
 * Layout produced:
 *   system: [
 *     { text: <args.system> },
 *     { cachePoint: { type: "default" } },        // if "system" in cachePoints
 *   ]
 *   messages: [
 *     {
 *       role: "user",
 *       content: [
 *         { text: <args.layeredContext.subject> },
 *         { cachePoint: { type: "default" } },    // if "subject" in cachePoints
 *         { text: <args.layeredContext.concept> },
 *         { cachePoint: { type: "default" } },    // if "concept" in cachePoints
 *         { text: <retrieved chunks + user task>}, // NEVER cached
 *       ],
 *     },
 *     ...args.messages,                           // any follow-ups
 *   ]
 *
 * If `args.layeredContext` is absent, cachePoints is ignored and the function
 * behaves exactly like the Phase 0 stub (back-compat for pre-Phase-5 callers).
 *
 * Bedrock notes:
 *   - On Ollama: this code path is bypassed entirely (createOllamaLlm is the
 *     LLM facade for ollama). cachePoints arg silently no-ops there.
 *   - cachePoint support is per-model; pin Sonnet/Haiku to confirmed-cached
 *     model IDs in us-east-1 (prod-changes.md §1, §4).
 */
export async function converse(args: ConverseArgs): Promise<ConverseResult> {
  const client = getBedrockClient();

  const wantsSystemCache = args.cachePoints?.includes("system") ?? false;
  const wantsSubjectCache = args.cachePoints?.includes("subject") ?? false;
  const wantsConceptCache = args.cachePoints?.includes("concept") ?? false;

  // System array.
  const systemBlocks: SystemContentBlock[] = [];
  if (args.system) {
    systemBlocks.push({ text: args.system });
    if (wantsSystemCache) systemBlocks.push(CACHE_POINT_BLOCK);
  }

  // Build the layered first user message if layered context is present.
  const messages: Message[] = [];
  const lc = args.layeredContext;
  if (lc) {
    const firstContent: ContentBlock[] = [];
    if (lc.subject) {
      firstContent.push({ text: lc.subject });
      if (wantsSubjectCache) firstContent.push(CACHE_POINT_BLOCK);
    }
    if (lc.concept) {
      firstContent.push({ text: lc.concept });
      if (wantsConceptCache) firstContent.push(CACHE_POINT_BLOCK);
    }
    // Retrieved + user-turn block. NEVER followed by cachePoint.
    if (lc.userTurn) firstContent.push({ text: lc.userTurn });
    messages.push({ role: "user", content: firstContent });
  }

  for (const m of args.messages) {
    messages.push({
      role: m.role,
      content: m.content.map((c) => ({ text: c.text })),
    });
  }

  const command = new ConverseCommand({
    modelId: args.modelId,
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    messages,
    inferenceConfig: {
      maxTokens: args.maxTokens ?? 1024,
      temperature: args.temperature ?? 0.2,
    },
  });

  const response = await client.send(command);
  const block = response.output?.message?.content?.[0];
  const text = block && "text" in block ? (block.text ?? "") : "";

  return {
    text,
    modelId: args.modelId,
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      cacheReadInputTokens: response.usage?.cacheReadInputTokens ?? undefined,
      cacheWriteInputTokens: response.usage?.cacheWriteInputTokens ?? undefined,
    },
    stopReason: response.stopReason ?? undefined,
  };
}
