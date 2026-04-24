import {
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organization } from "./auth.js";

/**
 * Profiles are an org sub-unit that groups platform accounts.
 *
 * One org can hold many profiles — an agency uses one profile per client; a
 * brand with multiple product lines uses one profile per line. Posts publish
 * through accounts, accounts belong to a profile, and an API key can either
 * be org-wide (any profile) or scoped to a single profile.
 *
 * Crucially, profiles are FREE — pricing stays flat at the org level. This is
 * the commercial wedge against per-profile incumbents (research-corpus
 * problem #5).
 *
 * `slug` is unique-per-org and URL-safe; the dashboard renders it for
 * routing once we add per-profile detail pages.
 */
export const profiles = pgTable(
  "profiles",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    ...timestamps,
  },
  (t) => ({
    byOrg: index("profiles_organization_id_idx").on(t.organizationId),
    uniqOrgSlug: uniqueIndex("profiles_org_slug_unique").on(
      t.organizationId,
      t.slug,
    ),
  }),
);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
