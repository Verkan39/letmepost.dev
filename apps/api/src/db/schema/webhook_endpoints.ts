import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organization } from "./auth.js";

/**
 * Outbound webhook subscriptions. One row per (org, url). The plaintext
 * signing secret is never stored — only the sha256 of it, so we can verify
 * that a rotated secret matches without keeping the original on disk. The
 * plaintext is shown to the user exactly once at creation time, same pattern
 * as `api_keys`.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /**
     * Plaintext signing secret — used at delivery time to HMAC-sign the body.
     * Stored at rest because the worker needs it on every delivery and we
     * don't yet run token encryption outside of OAuth tokens. Future work:
     * migrate onto the envelope encryption module.
     */
    signingSecret: text("signing_secret").notNull(),
    /** sha256(plaintext secret) — returned nowhere, used for integrity checks. */
    secretHash: text("secret_hash").notNull(),
    description: text("description"),
    /** Optional filter; empty array subscribes to everything. */
    eventFilter: jsonb("event_filter").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    lastDeliveryAt: timestamp("last_delivery_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastFailureReason: text("last_failure_reason"),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => ({
    byOrg: index("webhook_endpoints_organization_id_idx").on(t.organizationId),
  }),
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
