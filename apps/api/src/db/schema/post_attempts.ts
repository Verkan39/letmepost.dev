import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { idColumn } from "./_shared.js";
import { posts } from "./posts.js";

/**
 * One row per publish attempt against the upstream platform — kept for observability,
 * retry history, and surfacing raw platform responses in the error contract.
 */
export const postAttempts = pgTable(
  "post_attempts",
  {
    id: idColumn(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    succeeded: boolean("succeeded"),
    platformResponse: jsonb("platform_response"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
  },
  (t) => ({
    byPost: index("post_attempts_post_id_idx").on(t.postId),
  }),
);

export type PostAttempt = typeof postAttempts.$inferSelect;
export type NewPostAttempt = typeof postAttempts.$inferInsert;
