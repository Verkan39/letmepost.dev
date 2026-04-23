import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organizations } from "./organizations.js";

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    signingSecret: text("signing_secret").notNull(),
    /** Event names this endpoint subscribes to; empty array means all events. */
    eventFilter: jsonb("event_filter").$type<string[]>().notNull().default([]),
    disabledAt: timestamp("disabled_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => ({
    byOrg: index("webhook_endpoints_organization_id_idx").on(t.organizationId),
  }),
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
