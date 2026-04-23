import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organizations } from "./organizations.js";

export const apiKeyPrefix = pgEnum("api_key_prefix", [
  "lmp_live_",
  "lmp_test_",
]);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: apiKeyPrefix("prefix").notNull(),
    hashedKey: text("hashed_key").notNull(),
    last4: varchar("last4", { length: 4 }).notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => ({
    hashedKeyUnique: uniqueIndex("api_keys_hashed_key_unique").on(t.hashedKey),
    byOrg: index("api_keys_organization_id_idx").on(t.organizationId),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
