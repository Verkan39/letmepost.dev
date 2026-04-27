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

/**
 * Trusted origins list. Local dev's dashboard (:3001) is always allowed;
 * production origins come in via `TRUSTED_ORIGINS` (comma-separated) so the
 * deploy can add `https://dashboard.letmepost.dev` without a code change.
 */
const trustedOrigins = [
  "http://localhost:3001",
  ...(process.env.TRUSTED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? []),
];

/**
 * Cross-subdomain cookies. In production the API sits at api.letmepost.dev
 * and the dashboard at dashboard.letmepost.dev; the session cookie needs
 * `Domain=.letmepost.dev; SameSite=None; Secure` so both subdomains share
 * it. The COOKIE_DOMAIN env opts in (e.g. `.letmepost.dev`); leaving it
 * unset keeps dev behaviour single-origin (default cookie scope).
 */
const cookieDomain = process.env.COOKIE_DOMAIN;
const crossSubDomainCookies = cookieDomain
  ? {
      crossSubDomainCookies: {
        enabled: true,
        domain: cookieDomain,
      },
      defaultCookieAttributes: {
        sameSite: "none" as const,
        secure: true,
      },
    }
  : {};

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
    ...crossSubDomainCookies,
  },
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: buildSocialProviders(),
  plugins: [organization()],
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins,
});

export type Auth = typeof auth;
