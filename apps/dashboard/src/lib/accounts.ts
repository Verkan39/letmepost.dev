/**
 * Client-side shape mirror of the `/v1/accounts/connect/:platform` contract.
 *
 * The API returns a descriptor the dashboard branches on:
 *   - `kind: "oauth"`      — redirect the browser to `authorizationUrl`
 *   - `kind: "credentials"` — render `fields[]` as a form, POST results to
 *                             `/v1/accounts/connect/:platform/complete`
 *
 * This file intentionally restates the shape rather than importing it from
 * `@letmepost/schemas` — the accounts framework is being built in a parallel
 * worktree and we don't want a cross-package coupling to flap our build.
 */

export type OAuthDescriptor = {
  kind: "oauth";
  authorizationUrl: string;
  state?: string;
};

export type CredentialsField = {
  name: string;
  label: string;
  type?: "text" | "password" | "email";
  required?: boolean;
  placeholder?: string;
  description?: string;
};

export type CredentialsDescriptor = {
  kind: "credentials";
  fields: CredentialsField[];
};

export type ConnectDescriptor = OAuthDescriptor | CredentialsDescriptor;

export type ConnectResponse = {
  platform: string;
  descriptor: ConnectDescriptor;
};

export type Account = {
  id: string;
  platform: string;
  handle?: string;
  displayName?: string;
  createdAt?: string;
  tokenExpiresAt?: string | null;
};

/**
 * Connectable platforms surfaced in the dashboard. Mirrors the Platform enum
 * in @letmepost/schemas; kept local so the dashboard build doesn't pull in
 * schemas' zod transitive. Adding a platform = update both places.
 */
export const CONNECTABLE_PLATFORMS = [
  "bluesky",
  "facebook",
  "instagram",
  "linkedin",
  "pinterest",
  "threads",
  "twitter",
] as const;
export type ConnectablePlatform = (typeof CONNECTABLE_PLATFORMS)[number];

// Re-export the canonical PLATFORM_STATE + PlatformState from the
// zod-free schemas subpath so the dashboard bundle stays clean. There's
// exactly one definition of these values across the monorepo.
export {
  PLATFORM_STATE,
  type PlatformState,
} from "@letmepost/schemas/platform-state";
