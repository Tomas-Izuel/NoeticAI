import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import { env, googleAuthConfigured, notionAuthConfigured } from "../env";

// ---------------------------------------------------------------------------
// Sign-in providers
//
// • email + password — better-auth's emailAndPassword module
// • Notion — better-auth's built-in social provider (added in 1.6).
//   Notion's `/users/me` endpoint returns the bot owner — when the workspace
//   doesn't expose the user's email, we synthesize a placeholder so the
//   NOT-NULL `user.email` column accepts the row. The web app surfaces a
//   banner asking the user to claim a real email later.
// • Google — built-in social provider, env-gated. The frontend button is
//   rendered disabled until both client_id and client_secret are present.
// ---------------------------------------------------------------------------

interface SocialProviderConfig {
  clientId: string;
  clientSecret: string;
  mapProfileToUser?: (profile: unknown) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

const socialProviders: Record<string, SocialProviderConfig> = {};

if (notionAuthConfigured()) {
  socialProviders.notion = {
    clientId: env.NOTION_CLIENT_ID!,
    clientSecret: env.NOTION_CLIENT_SECRET!,
    mapProfileToUser: (raw) => {
      // The built-in Notion provider passes bot.owner.user as `profile` and
      // sets email to `person?.email || null`. user.email is NOT NULL in our
      // schema, so synthesize a stable placeholder when Notion didn't expose
      // a real email. The override is applied via spread *after* defaults.
      const profile = raw as {
        id?: string;
        person?: { email?: string };
      };
      const realEmail = profile.person?.email;
      if (realEmail && realEmail.length > 0) {
        return { emailVerified: true };
      }
      const id = profile.id ?? "unknown";
      return {
        email: `notion-${id}@noeticai.local`,
        emailVerified: false,
      };
    },
  };
}

if (googleAuthConfigured()) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
  };
}

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders,
  account: {
    accountLinking: {
      // When a user signs up with email/password and later signs in with
      // Notion using the same email, link the accounts rather than failing.
      enabled: true,
      trustedProviders: ["notion"],
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.WEB_URL],
});
