import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "./bedrock";
import type { EmbedArgs, EmbedResult } from "./types";

export interface EmbedConfig {
  defaultModelId: string;
}

export interface EmbedClient {
  embed(args: EmbedArgs): Promise<EmbedResult>;
  // The model the client uses when no per-call override is given. Callers
  // need this to filter existing rows BEFORE the embed call (e.g. the
  // ingest pipeline's "skip if already embedded under this model" check).
  readonly defaultModelId: string;
}

interface CohereEmbedResponse {
  embeddings: { float: number[][] } | number[][];
  id?: string;
  texts?: string[];
}

export function createEmbed(cfg: EmbedConfig): EmbedClient {
  return {
    defaultModelId: cfg.defaultModelId,
    embed: async (args) => {
      const modelId = args.modelId ?? cfg.defaultModelId;
      const client: BedrockRuntimeClient = getBedrockClient();
      const body = {
        texts: args.texts,
        input_type: args.inputType ?? "search_document",
        embedding_types: ["float"],
      };
      const cmd = new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(JSON.stringify(body)),
      });
      const response = await client.send(cmd);
      const decoded: CohereEmbedResponse = JSON.parse(
        new TextDecoder().decode(response.body),
      );
      const vectors: number[][] = Array.isArray(decoded.embeddings)
        ? (decoded.embeddings as number[][])
        : decoded.embeddings.float;
      const dim = vectors[0]?.length ?? 0;
      return { modelId, dim, vectors };
    },
  };
}
