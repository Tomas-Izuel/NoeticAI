import { createLlm, createEmbed } from "@noeticai/ai";
import { env } from "../env";

export const llm = createLlm({
  opusId: env.NOETICAI_BEDROCK_OPUS_ID,
  sonnetId: env.NOETICAI_BEDROCK_SONNET_ID,
  haikuId: env.NOETICAI_BEDROCK_HAIKU_ID,
});

export const embed = createEmbed({
  defaultModelId: env.NOETICAI_BEDROCK_EMBED_ID,
});
