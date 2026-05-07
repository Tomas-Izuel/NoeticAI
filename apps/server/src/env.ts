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

  AWS_REGION: z.string().min(1),
  AWS_ACCESS_KEY_ID: z.string().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().min(1),

  NOETICAI_BEDROCK_OPUS_ID: z.string().min(1),
  NOETICAI_BEDROCK_SONNET_ID: z.string().min(1),
  NOETICAI_BEDROCK_HAIKU_ID: z.string().min(1),
  // Notes/sources default to Spanish per project context. Override per-subject
  // when an English-only Subject lands (plan.md §4.2 multilingual note).
  NOETICAI_BEDROCK_EMBED_ID: z.string().min(1).default("cohere.embed-multilingual-v3"),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  WEB_URL: z.string().url().default("http://localhost:5174"),

  SECRET_BOX_KEY: base64Bytes(32),

  // "1" → skip Bedrock pings in /health (saves dev tokens)
  NOETICAI_HEALTH_SKIP_BEDROCK: z.enum(["0", "1"]).default("0"),

  PORT: z.coerce.number().int().positive().default(3000),
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

export const healthSkipBedrock = env.NOETICAI_HEALTH_SKIP_BEDROCK === "1";
