import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organization } from "./auth.js";
import { platform } from "./platform_versions.js";
import { profiles } from "./profiles.js";

/**
 * Per-platform connected social media account (Bluesky, LinkedIn, etc.).
 * Tokens are stored as an AES-256-GCM envelope:
 *   - token_ciphertext       base64 of token bytes encrypted under a fresh DEK
 *   - token_dek_ciphertext   base64 of (iv || authTag || DEK-wrapped-by-KEK)
 *   - token_iv               base64 of the 12-byte IV used for the token ciphertext
 *   - token_auth_tag         base64 of the 16-byte GCM auth tag for the token ciphertext
 *
 * Nothing outside apps/api/src/repositories/platform-accounts.ts should read
 * these columns. Named "platform_accounts" to avoid collision with
 * better-auth's "account" (which holds OAuth provider links for sign-in).
 */
export const platformAccounts = pgTable(
  "platform_accounts",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    platform: platform("platform").notNull(),
    /** Stable per-platform identifier — e.g. Bluesky DID, LinkedIn URN. */
    platformAccountId: text("platform_account_id").notNull(),
    /** Human-readable handle for dashboard display. */
    displayName: text("display_name"),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenDekCiphertext: text("token_dek_ciphertext").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenAuthTag: text("token_auth_tag").notNull(),
    /** Non-secret token metadata — e.g. scopes, expires_at, refresh_expires_at. */
    tokenMetadata: jsonb("token_metadata").$type<Record<string, unknown>>(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (t) => ({
    byOrg: index("platform_accounts_organization_id_idx").on(t.organizationId),
    byProfile: index("platform_accounts_profile_id_idx").on(t.profileId),
    uniqPlatformAccount: uniqueIndex(
      "platform_accounts_org_platform_account_unique",
    ).on(t.organizationId, t.platform, t.platformAccountId),
  }),
);

export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type NewPlatformAccount = typeof platformAccounts.$inferInsert;
