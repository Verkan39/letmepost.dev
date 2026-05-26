import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "../auth.js";
import { db } from "../db/instance.js";
import { user } from "../db/schema/auth.js";
import { LetmepostError } from "../errors.js";

/**
 * `/v1/auth/attribution` — backfill first-touch attribution after an OAuth
 * signup. The email/password path passes these fields through better-auth's
 * `additionalFields` at signup time and never needs to hit this route.
 * OAuth has no equivalent passthrough (the user redirects to Google/GitHub
 * and back; we can't piggyback fields on that round-trip), so the dashboard
 * stashes attribution in localStorage on first arrival and PATCHes it here
 * once the session lands.
 *
 * Refuses to overwrite an existing signupSource — a second OAuth round-
 * trip can't clobber the channel of original capture. That makes the
 * endpoint safely idempotent: if the dashboard retries, only the first
 * call has any effect.
 */

// Tight cap on each field — none of these are user-controlled in the
// product surface, and a runaway UTM tag should not become unbounded
// storage. 256 covers every real-world UTM and full referrer URL.
const STRING_LIMIT = 512;
const optionalString = z.string().max(STRING_LIMIT).optional();

const AttributionBody = z.object({
  signupSource: optionalString,
  signupUtmSource: optionalString,
  signupUtmMedium: optionalString,
  signupUtmCampaign: optionalString,
  signupUtmContent: optionalString,
  signupUtmTerm: optionalString,
  signupReferrer: optionalString,
  signupLandingPath: optionalString,
});

export const attribution = new Hono();

attribution.post("/", zValidator("json", AttributionBody), async (c) => {
  // We use better-auth directly (not `requireSession()`) because a freshly
  // OAuth'd user has no active organization yet — they're between signup
  // and org-creation. `requireSession()` would reject that as 403, which
  // is exactly the window we need this to work in.
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.session || !result.user) {
    throw new LetmepostError({
      code: "unauthenticated",
      status: 401,
      message: "You must be signed in.",
    });
  }

  const body = c.req.valid("json");
  // Strip any keys that came through as empty strings — Drizzle would
  // happily write "" into the column otherwise, and "" reads as
  // "we know nothing" in a way that's worse than NULL.
  const updates: Partial<typeof user.$inferInsert> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" && value.length > 0) {
      (updates as Record<string, string>)[key] = value;
    }
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ updated: false, reason: "no_fields_provided" });
  }

  // First-touch: only write if signup_source is still null. The WHERE
  // clause makes this atomic — concurrent calls race harmlessly.
  const updated = await db
    .update(user)
    .set(updates)
    .where(and(eq(user.id, result.user.id), isNull(user.signupSource)))
    .returning();

  return c.json({ updated: updated.length > 0 });
});
