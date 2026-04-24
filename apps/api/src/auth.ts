import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "./db/instance.js";
import * as authSchema from "./db/schema/auth.js";
import { uuidv7 } from "./db/uuid.js";

function buildSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> =
    {};

  const googleId = process.env.GOOGLE_CLIENT_ID;
  const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (googleId && googleSecret) {
    providers.google = { clientId: googleId, clientSecret: googleSecret };
  }

  const githubId = process.env.GITHUB_CLIENT_ID;
  const githubSecret = process.env.GITHUB_CLIENT_SECRET;
  if (githubId && githubSecret) {
    providers.github = { clientId: githubId, clientSecret: githubSecret };
  }

  return providers;
}

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || secret.length < 16) {
  throw new Error(
    "BETTER_AUTH_SECRET env var is not set or too short. Generate one with `openssl rand -base64 32` and add it to apps/api/.env.",
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
      organization: authSchema.organization,
      member: authSchema.member,
      invitation: authSchema.invitation,
    },
  }),
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: buildSocialProviders(),
  plugins: [organization()],
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  // The dashboard runs on :3001 in dev; better-auth blocks cross-origin
  // cookie flows otherwise. Expand this list as other surfaces come online.
  trustedOrigins: ["http://localhost:3001"],
});

export type Auth = typeof auth;
