import { pgEnum, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const organizationMemberRole = pgEnum("organization_member_role", [
  "owner",
  "admin",
  "member",
]);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationMemberRole("role").notNull().default("member"),
    ...timestamps,
  },
  (t) => ({
    uniqMembership: uniqueIndex("organization_members_org_user_unique").on(
      t.organizationId,
      t.userId,
    ),
  }),
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
