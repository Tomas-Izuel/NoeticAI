import type { Llm, TierArgs } from "./llm";
import type { EmbedClient } from "./embed";
import type { ConverseResult, EmbedArgs, EmbedResult } from "./types";

export interface OllamaConfig {
  baseUrl: string;   // e.g. http://localhost:11434
  llmModel: string;  // used for all three tiers in dev
  embedModel: string;
}

// --- Ollama HTTP response shapes ---

interface OllamaChatMessage {
  role: string;
  content: string;
}

interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

// --- shared fetch helper ---

async function ollamaPost<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`Ollama ${path} returned HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// --- LLM ---

async function ollamaConverse(
  cfg: OllamaConfig,
  args: TierArgs,
): Promise<ConverseResult> {
  // Build the messages array in Ollama's shape.
  // ConverseArgs uses { role, content: [{ text }] }; Ollama wants { role, content: string }.
  const messages: Array<{ role: string; content: string }> = [];

  if (args.system) {
    messages.push({ role: "system", content: args.system });
  }

  for (const msg of args.messages) {
    const text = msg.content.map((c) => c.text).join("\n");
    messages.push({ role: msg.role, content: text });
  }

  const response = await ollamaPost<OllamaChatResponse>(cfg.baseUrl, "/api/chat", {
    model: cfg.llmModel,
    messages,
    stream: false,
    options: {
      temperature: args.temperature ?? 0.7,
      num_predict: args.maxTokens ?? 2048,
    },
  });

  return {
    text: response.message.content,
    modelId: cfg.llmModel,
    usage: {
      inputTokens: response.prompt_eval_count ?? 0,
      outputTokens: response.eval_count ?? 0,
      // Ollama does not expose cache token counts.
    },
    stopReason: response.done_reason ?? undefined,
  };
}

export function createOllamaLlm(cfg: OllamaConfig): Llm {
  // In dev mode, all three tiers (opus, sonnet, haiku) collapse to the same
  // cfg.llmModel. This is the documented dev simplification — not a bug.
  // For prose-quality evaluation (Phases 3 + 5 kill criteria) real Bedrock is required.
  return {
    opus: (args: TierArgs) => ollamaConverse(cfg, args),
    sonnet: (args: TierArgs) => ollamaConverse(cfg, args),
    haiku: (args: TierArgs) => ollamaConverse(cfg, args),
  };
}

// --- Embed ---

export function createOllamaEmbed(cfg: OllamaConfig): EmbedClient {
  return {
    defaultModelId: cfg.embedModel,
    embed: async (args: EmbedArgs): Promise<EmbedResult> => {
      const modelId = args.modelId ?? cfg.embedModel;

      const response = await ollamaPost<OllamaEmbedResponse>(cfg.baseUrl, "/api/embed", {
        model: modelId,
        input: args.texts,
      });

      const vectors = response.embeddings;
      const dim = vectors[0]?.length ?? 0;

      // NOTE: dim mismatch (e.g. != 1024) is intentionally not thrown here.
      // The pipeline already validates dim after the call and will surface the
      // error there. Keeping this function pure makes it easier to test.

      return { modelId, dim, vectors };
    },
  };
}
