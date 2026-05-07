import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { ConverseArgs, ConverseResult } from "./types";

let _client: BedrockRuntimeClient | null = null;

export function getBedrockClient(region?: string): BedrockRuntimeClient {
  if (_client) return _client;
  _client = new BedrockRuntimeClient({
    region: region ?? process.env.AWS_REGION ?? "us-east-1",
  });
  return _client;
}

// Phase 0: cache points are accepted but not yet inserted into the request.
// Phase 5 will translate cachePoints into Bedrock Converse `cachePoint` markers
// per layer (system / subject context / concept context).
export async function converse(args: ConverseArgs): Promise<ConverseResult> {
  const client = getBedrockClient();
  const command = new ConverseCommand({
    modelId: args.modelId,
    system: args.system ? [{ text: args.system }] : undefined,
    messages: args.messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) => ({ text: c.text })),
    })),
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
