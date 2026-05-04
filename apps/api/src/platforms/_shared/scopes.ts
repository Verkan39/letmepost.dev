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
  linkedin: {
    kind: "oauth",
    // MVP — personal posting only. `w_member_social` is the Sign-In-with-
    // LinkedIn product scope; available on the standard dev tier without
    // MDP. `openid` + `profile` are needed to mint a stable identifier so
    // completeConnect can resolve the `urn:li:person:*` URN.
    write: ["w_member_social", "openid", "profile"],
    // Org/Company posts and `w_organization_social` require MDP — they ship
    // in the post-approval Phase 6 follow-up slice.
    extended: ["email", "r_organization_social", "w_organization_social"],
  },
  pinterest: {
    kind: "oauth",
    // Publish scope set: read the caller's boards, read/write pins, create
    // boards, and read the user's account info.
    //
    // `user_accounts:read` is required because completeConnect calls
    // `GET /v5/user_account` to pin the platform_account_id to the real
    // Pinterest user (instead of a synthetic uuid). Without this scope
    // Pinterest 403s that call and the whole connect surfaces as
    // platform_rejected.
    //
    // `boards:write` covers the boardless-account case — letting users
    // create their first board from the dashboard instead of dead-ending.
    //
    // Pinterest requires `pins:read` alongside `pins:write` because some
    // endpoints echo the pin back on create.
    write: [
      "boards:read",
      "boards:write",
      "pins:read",
      "pins:write",
      "user_accounts:read",
    ],
    extended: ["pins:read_secret"],
  },
  facebook: {
    kind: "oauth",
    // Facebook Login for Business scopes. The single connect grants both
    // FB Page publish AND linked Instagram Business publish — Pages are
    // discovered via `GET /me/accounts`, IG Business via the Page's
    // `instagram_business_account` field. Same OAuth, two letmepost
    // platforms (`facebook` + `instagram`) get rows from one connect.
    //
    //   pages_show_list             — list the Pages the user manages.
    //   pages_manage_posts          — create posts on Pages.
    //   pages_read_engagement       — required pre-req for posts on some apps.
    //   business_management         — needed for Pages connected via Business.
    //   instagram_basic             — read IG Business account info per Page.
    //   instagram_content_publish   — two-step container publish on IG.
    write: [
      "pages_show_list",
      "pages_manage_posts",
      "pages_read_engagement",
      "business_management",
      "instagram_basic",
      "instagram_content_publish",
    ],
    // Insights / messaging are big extended sets we don't request by
    // default. Listed individually so the docs page can render the full
    // surface without having to enumerate Meta's catalog.
    extended: [
      "pages_read_user_content",
      "pages_manage_engagement",
      "instagram_manage_comments",
      "instagram_manage_insights",
    ],
  },
  instagram: {
    kind: "oauth",
    // IG Business is connected via the Facebook OAuth flow above — the
    // 'instagram' platform doesn't have its own connect endpoint. Listed
    // here for parity (the route /v1/accounts/connect/instagram is
    // disabled at the dispatcher; users connect via 'meta' / 'facebook').
    write: ["instagram_basic", "instagram_content_publish"],
    extended: ["instagram_manage_comments", "instagram_manage_insights"],
  },
  threads: {
    kind: "oauth",
    // Threads Graph API standalone OAuth (separate from Facebook Login for
    // Business). `threads_basic` is mandatory — the bare-minimum scope that
    // lets the token call `GET /me`. `threads_content_publish` is what
    // unlocks the create-container + publish flow.
    //
    // Reply / read scopes are extended-only because v1 of the publisher
    // doesn't read replies — the publisher *posts* replies via reply_to_id
    // on the request body, which requires no extra scope (it's a write).
    write: ["threads_basic", "threads_content_publish"],
    extended: ["threads_manage_replies", "threads_read_replies"],
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
