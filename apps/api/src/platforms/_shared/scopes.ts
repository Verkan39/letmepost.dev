import type { Platform } from "@letmepost/schemas";

/**
 * Canonical per-platform OAuth scope registry. **Narrow-by-default** — the
 * `write` set is the minimum needed to publish for the v1 Publisher scope.
 * `extended` is optional extras (e.g. read analytics) we don't request unless
 * the caller opts in.
 *
 * This is a direct answer to Ayrshare's broad-scope complaint: users should
 * not have to grant "manage pages, ads, everything" to publish a post.
 *
 * Bluesky is included as `kind: "credentials"` with an empty scope list —
 * app passwords don't have OAuth scopes, but keeping the shape uniform means
 * provider code never special-cases "is this OAuth or not" at the scope layer.
 */

export type PlatformScopeSet = {
  /** The minimum set required to publish. Requested by default. */
  write: readonly string[];
  /** Optional additions callers can opt into (e.g. analytics). Not requested by default. */
  extended: readonly string[];
  /** "credentials" for Bluesky, "oauth" for everything else. */
  kind: "oauth" | "credentials";
};

const SCOPES: Record<Platform, PlatformScopeSet> = {
  bluesky: {
    kind: "credentials",
    write: [],
    extended: [],
  },
  pinterest: {
    kind: "oauth",
    // MVP scope for Pinterest publish: read the caller's boards, read/write
    // pins. Pinterest requires `pins:read` alongside `pins:write` because
    // some endpoints echo the pin back on create.
    write: ["boards:read", "pins:read", "pins:write"],
    extended: ["user_accounts:read", "pins:read_secret"],
  },
  twitter: {
    kind: "oauth",
    // X OAuth 2.0 scopes: posting needs `tweet.write`; `tweet.read` +
    // `users.read` are required to mint the token at all; `offline.access`
    // is what makes X issue a refresh token.
    write: ["tweet.write", "tweet.read", "users.read", "offline.access"],
    extended: ["like.read", "follows.read"],
  },
};

export function writeScopesFor(platform: Platform): readonly string[] {
  return SCOPES[platform].write;
}

/**
 * Wider-than-Platform lookup used where the caller holds a DB-enum value
 * rather than the narrow user-visible Platform union. Unknown platforms
 * return `"oauth"` as the conservative default (most future platforms are
 * OAuth; the boundary check is in getProvider, not here).
 */
export function scopeKindFor(platform: string): PlatformScopeSet["kind"] {
  const known = SCOPES[platform as Platform];
  return known ? known.kind : "oauth";
}

export function scopeSetFor(platform: Platform): PlatformScopeSet {
  return SCOPES[platform];
}
