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

// Titan Text Embeddings v2 request/response shape.
// Titan v2 is single-text-per-call; we loop with bounded concurrency to
// preserve the (texts: string[]) -> vectors: number[][] contract callers
// depend on (see EmbedResult in ./types).
interface TitanEmbedRequest {
  inputText: string;
  dimensions: 256 | 512 | 1024;
  normalize: boolean;
}

interface TitanEmbedResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

// Matches the audit-worker per-Haiku concurrency cap and Phase 5 completion
// worker target. Tuned low for default Titan TPM quotas; raise after the
// quota ticket (deploy.md §3.5) lands.
const TITAN_PARALLELISM = 4;

export function createEmbed(cfg: EmbedConfig): EmbedClient {
  return {
    defaultModelId: cfg.defaultModelId,
    embed: async (args) => {
      const modelId = args.modelId ?? cfg.defaultModelId;
      // args.inputType is kept for API stability (Cohere distinguished
      // search_document vs search_query). Titan v2 has no equivalent knob;
      // it's a no-op here but every call site passes it.
      void args.inputType;

      const client: BedrockRuntimeClient = getBedrockClient();
      const vectors: number[][] = new Array(args.texts.length);

      let cursor = 0;
      const work = async () => {
        while (true) {
          const i = cursor++;
          if (i >= args.texts.length) return;
          const body: TitanEmbedRequest = {
            inputText: args.texts[i] ?? "",
            // Pinned to 1024 because all *_embeddings columns are
            // vector(1024). Do NOT make this configurable from args without
            // a schema migration.
            dimensions: 1024,
            // false = un-normalized output. Chosen to keep the cosine
            // similarity distribution closest to the prior Cohere v3 rows so
            // calibrated thresholds and SIMILARITY_FLOOR don't have to be
            // re-tuned in the same migration.
            normalize: false,
          };
          const cmd = new InvokeModelCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: new TextEncoder().encode(JSON.stringify(body)),
          });
          const response = await client.send(cmd);
          const decoded: TitanEmbedResponse = JSON.parse(
            new TextDecoder().decode(response.body),
          );
          vectors[i] = decoded.embedding;
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(TITAN_PARALLELISM, args.texts.length) },
          work,
        ),
      );

      const dim = vectors[0]?.length ?? 0;
      return { modelId, dim, vectors };
    },
  };
}
