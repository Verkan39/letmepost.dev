import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { idColumn, timestamps } from "./_shared.js";

export const users = pgTable(
  "users",
  {
    id: idColumn(),
    email: text("email").notNull(),
    name: text("name"),
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
