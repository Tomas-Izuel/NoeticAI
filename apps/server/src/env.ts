import { z } from "zod";

const base64Bytes = (expected: number) =>
  z
    .string()
    .min(1)
    .refine(
      (s) => {
        try {
          return Buffer.from(s, "base64").length === expected;
        } catch {
          return false;
        }
      },
      { message: `must be base64-encoded ${expected} bytes` },
    );

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // AI backend selector. "bedrock" = production (AWS Bedrock); "ollama" = local dev.
  NOETICAI_AI_BACKEND: z.enum(["bedrock", "ollama"]).default("bedrock"),

  // --- Ollama settings (only active when NOETICAI_AI_BACKEND=ollama) ---
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  NOETICAI_OLLAMA_LLM_MODEL: z.string().min(1).default("gemma4:e4b"),
  NOETICAI_OLLAMA_EMBED_MODEL: z.string().min(1).default("bge-m3"),

  // --- AWS / Bedrock settings (only active when NOETICAI_AI_BACKEND=bedrock) ---
  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  NOETICAI_BEDROCK_OPUS_ID: z.string().min(1),
  NOETICAI_BEDROCK_SONNET_ID: z.string().min(1),
  NOETICAI_BEDROCK_HAIKU_ID: z.string().min(1),
  // Notes/sources default to Spanish per project context. Override per-subject
  // when an English-only Subject lands (plan.md §4.2 multilingual note).
  NOETICAI_BEDROCK_EMBED_ID: z.string().min(1).default("amazon.titan-embed-text-v2:0"),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:8080"),
  WEB_URL: z.string().url().default("http://localhost:3000"),

  // --- Notion OAuth (optional — server boots without these) ---
  // Obtain from https://www.notion.so/my-integrations → your public integration.
  // The same client_id/secret powers TWO flows; register BOTH redirect URIs in
  // the Notion integration settings:
  //   • {BETTER_AUTH_URL}/api/auth/callback/notion   — sign-in (built-in)
  //   • {BETTER_AUTH_URL}/api/oauth/notion/callback  — workspace connection
  NOTION_CLIENT_ID: z.string().min(1).optional(),
  NOTION_CLIENT_SECRET: z.string().min(1).optional(),
  // Workspace-connection redirect URI (post-login data-source flow).
  NOTION_OAUTH_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .default("http://localhost:8080/api/oauth/notion/callback"),

  // --- Google OAuth (optional — server boots without these) ---
  // Obtain from https://console.cloud.google.com → Credentials → OAuth 2.0.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  SECRET_BOX_KEY: base64Bytes(32),

  // "1" → skip AI pings in /health (saves dev tokens/time).
  // Despite the legacy env var name "BEDROCK", this flag skips whichever
  // backend (bedrock or ollama) is currently active.
  NOETICAI_HEALTH_SKIP_BEDROCK: z.enum(["0", "1"]).default("0"),

  PORT: z.coerce.number().int().positive().default(8080),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`\n[env] invalid configuration:\n${issues}\n`);
    throw new Error("invalid environment configuration");
  }
  return parsed.data;
}

export const env: Env = loadEnv();

// Renamed from healthSkipBedrock — the env var name is intentionally preserved
// to avoid downstream churn; the flag now skips whichever backend is active.
export const healthSkipAi = env.NOETICAI_HEALTH_SKIP_BEDROCK === "1";

// Returns true only when all three Notion OAuth env vars are present and
// non-empty. Endpoints use this to return 503 when credentials are not set.
export function notionOauthConfigured(): boolean {
  return (
    typeof env.NOTION_CLIENT_ID === "string" &&
    env.NOTION_CLIENT_ID.length > 0 &&
    typeof env.NOTION_CLIENT_SECRET === "string" &&
    env.NOTION_CLIENT_SECRET.length > 0 &&
    typeof env.NOTION_OAUTH_REDIRECT_URI === "string" &&
    env.NOTION_OAUTH_REDIRECT_URI.length > 0
  );
}

// Returns true when Notion can be used as a sign-in provider via better-auth's
// genericOAuth plugin. NOTION_AUTH_REDIRECT_URI has a default so only
// client_id/secret need to be checked.
export function notionAuthConfigured(): boolean {
  return (
    typeof env.NOTION_CLIENT_ID === "string" &&
    env.NOTION_CLIENT_ID.length > 0 &&
    typeof env.NOTION_CLIENT_SECRET === "string" &&
    env.NOTION_CLIENT_SECRET.length > 0
  );
}

// Returns true when Google OAuth credentials are configured. When false the
// google socialProvider is not registered with better-auth.
export function googleAuthConfigured(): boolean {
  return (
    typeof env.GOOGLE_CLIENT_ID === "string" &&
    env.GOOGLE_CLIENT_ID.length > 0 &&
    typeof env.GOOGLE_CLIENT_SECRET === "string" &&
    env.GOOGLE_CLIENT_SECRET.length > 0
  );
}
