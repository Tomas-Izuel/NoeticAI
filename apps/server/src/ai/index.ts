import { createLlm, createEmbed, createOllamaLlm, createOllamaEmbed } from "@noeticai/ai";
import { env } from "../env";

// eslint-disable-next-line no-console
console.log(`[ai] backend=${env.NOETICAI_AI_BACKEND}`);

const ollamaCfg = {
  baseUrl: env.OLLAMA_BASE_URL,
  llmModel: env.NOETICAI_OLLAMA_LLM_MODEL,
  embedModel: env.NOETICAI_OLLAMA_EMBED_MODEL,
};

export const llm =
  env.NOETICAI_AI_BACKEND === "ollama"
    ? createOllamaLlm(ollamaCfg)
    : createLlm({
        opusId: env.NOETICAI_BEDROCK_OPUS_ID,
        sonnetId: env.NOETICAI_BEDROCK_SONNET_ID,
        haikuId: env.NOETICAI_BEDROCK_HAIKU_ID,
      });

export const embed =
  env.NOETICAI_AI_BACKEND === "ollama"
    ? createOllamaEmbed(ollamaCfg)
    : createEmbed({ defaultModelId: env.NOETICAI_BEDROCK_EMBED_ID });
