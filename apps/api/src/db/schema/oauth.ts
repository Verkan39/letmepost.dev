import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn } from "./_shared.js";
import { user, session } from "./auth.js";

/* -------------------------------------------------------------------------- */
/* better-auth oauth-provider plugin tables                                   */
/*                                                                            */
/* These power the OAuth 2.1 authorization-server surface exposed at          */
/* /api/auth/oauth2/* and the .well-known/* discovery endpoints. Used by MCP  */
/* clients (Claude Desktop, Cursor) to obtain bearer tokens for the API via   */
/* browser-redirect OAuth instead of pasting `lmp_live_…` API keys.           */
/*                                                                            */
/* Schema mirrors `@better-auth/oauth-provider`'s declared model — column     */
/* names match what the adapter writes. IDs are uuid (native pg type) to      */
/* stay consistent with every other table; better-auth treats them as opaque  */
/* strings via the drizzle adapter.                                           */
/* -------------------------------------------------------------------------- */

/**
 * A registered OAuth client. RFC 7591 dynamic registration writes rows here
 * (one per MCP-client install). For confidential clients `clientSecret` is
 * populated; public clients (PKCE-only) leave it null.
 */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: idColumn(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret"),
    disabled: boolean("disabled").notNull().default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    /** Owning user — set on user-authenticated registration; null when the
     * client was registered unauthenticated (MCP) and instead carries a
     * `referenceId`. */
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    public: boolean("public"),
    type: text("type"),
    requirePKCE: boolean("require_pkce"),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    clientIdUnique: uniqueIndex("oauth_client_client_id_unique").on(t.clientId),
    userIdIdx: index("oauth_client_user_id_idx").on(t.userId),
  }),
);

/**
 * Persisted refresh token granted to an OAuth client via `offline_access`.
 * Tokens here are stored hashed/opaque per better-auth's `formatRefreshToken`
 * default; the wire value uses a `rt_` prefix the plugin adds.
 */
export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: idColumn(),
    token: text("token").notNull(),
    clientId: text("client_id").notNull(),
    /** Tied to a better-auth session — when the session goes away (logout,
     * delete account) the refresh token is null'd via `onDelete: set null`,
     * effectively revoking it without losing the audit row. */
    sessionId: uuid("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    revoked: timestamp("revoked", { withTimezone: true, mode: "date" }),
    authTime: timestamp("auth_time", { withTimezone: true, mode: "date" }),
    scopes: text("scopes").array().notNull(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("oauth_refresh_token_token_unique").on(t.token),
    clientIdIdx: index("oauth_refresh_token_client_id_idx").on(t.clientId),
    sessionIdIdx: index("oauth_refresh_token_session_id_idx").on(t.sessionId),
    userIdIdx: index("oauth_refresh_token_user_id_idx").on(t.userId),
  }),
);

/**
 * Opaque access tokens (used when there's no audience for a JWT, eg
 * client-credentials grants). JWT-style access tokens for authorization-code
 * flows are emitted live and not persisted; refresh + introspect operate
 * against this table for opaque-mode clients.
 */
export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: idColumn(),
    token: text("token"),
    clientId: text("client_id").notNull(),
    sessionId: uuid("session_id").references(() => session.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    /** Pairs the access token to the refresh token that minted it; cascades
     * when the refresh is rotated. */
    refreshId: uuid("refresh_id").references(() => oauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    scopes: text("scopes").array().notNull(),
  },
  (t) => ({
    tokenUnique: uniqueIndex("oauth_access_token_token_unique").on(t.token),
    clientIdIdx: index("oauth_access_token_client_id_idx").on(t.clientId),
    sessionIdIdx: index("oauth_access_token_session_id_idx").on(t.sessionId),
    userIdIdx: index("oauth_access_token_user_id_idx").on(t.userId),
    refreshIdIdx: index("oauth_access_token_refresh_id_idx").on(t.refreshId),
  }),
);

/**
 * Per-(user, client) consent record. Looked up on every authorize call to
 * decide whether the consent screen is needed; updated when the user grants
 * new scopes.
 */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: idColumn(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    clientIdIdx: index("oauth_consent_client_id_idx").on(t.clientId),
    userIdIdx: index("oauth_consent_user_id_idx").on(t.userId),
  }),
);

/**
 * better-auth `jwt()` plugin key store. Holds the rotating JWK keypairs used
 * to sign OAuth access tokens (JWT mode). The public half is published at
 * /api/auth/jwks; the private half stays here and is read at sign time.
 */
export const jwks = pgTable("jwks", {
  id: idColumn(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
});

export type OAuthClient = typeof oauthClient.$inferSelect;
export type OAuthRefreshToken = typeof oauthRefreshToken.$inferSelect;
export type OAuthAccessToken = typeof oauthAccessToken.$inferSelect;
export type OAuthConsent = typeof oauthConsent.$inferSelect;
export type Jwks = typeof jwks.$inferSelect;
