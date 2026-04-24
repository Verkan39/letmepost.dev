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
 * MVP allowlist. The Platform enum in @letmepost/schemas only lists bluesky
 * today; Pinterest + Twitter are being added in a sibling worktree. Keeping
 * this hardcoded buys predictable UI without a cross-package build coupling.
 * Revisit once those providers land in packages/schemas.
 */
export const CONNECTABLE_PLATFORMS = [
  "bluesky",
  "pinterest",
  "twitter",
] as const;
export type ConnectablePlatform = (typeof CONNECTABLE_PLATFORMS)[number];
