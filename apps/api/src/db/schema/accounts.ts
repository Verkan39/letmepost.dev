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
import { organizations } from "./organizations.js";
import { platform } from "./platform_versions.js";

/**
 * Per-platform connected account. Tokens are stored as an AES-256-GCM envelope:
 *   - token_ciphertext       base64 of token bytes encrypted under a fresh DEK
 *   - token_dek_ciphertext   base64 of (iv || authTag || DEK-wrapped-by-KEK)
 *   - token_iv               base64 of the 12-byte IV used for the token ciphertext
 *   - token_auth_tag         base64 of the 16-byte GCM auth tag for the token ciphertext
 *
 * Nothing outside apps/api/src/repositories/accounts.ts should read these columns.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
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
    byOrg: index("accounts_organization_id_idx").on(t.organizationId),
    uniqPlatformAccount: uniqueIndex("accounts_org_platform_account_unique").on(
      t.organizationId,
      t.platform,
      t.platformAccountId,
    ),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
