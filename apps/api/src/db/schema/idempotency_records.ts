import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn } from "./_shared.js";
import { organizations } from "./organizations.js";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseBody: jsonb("response_body"),
    statusCode: integer("status_code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqOrgKey: uniqueIndex("idempotency_records_org_key_unique").on(
      t.organizationId,
      t.key,
    ),
    byCreatedAt: index("idempotency_records_created_at_idx").on(t.createdAt),
  }),
);

export type IdempotencyRecord = typeof idempotencyRecords.$inferSelect;
export type NewIdempotencyRecord = typeof idempotencyRecords.$inferInsert;
