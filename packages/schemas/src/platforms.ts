import { z } from "zod";

export const Platform = z.enum([
  "bluesky",
  "linkedin",
  "pinterest",
  "twitter",
  // Future: "instagram", "facebook", "threads", "tiktok"
]);
export type Platform = z.infer<typeof Platform>;

/**
 * A reference to a stored, connected platform account. The actual token
 * lives in the database, AES-256-GCM encrypted at rest, and is resolved
 * server-side by id scoped to the caller's organization.
 */
export const AccountRef = z.object({
  platform: Platform,
  id: z.string().uuid().describe("letmepost platform_account id"),
});
export type AccountRef = z.infer<typeof AccountRef>;
