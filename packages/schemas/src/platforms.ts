import { z } from "zod";

export const Platform = z.enum([
  "bluesky",
  // Future: "linkedin", "twitter", "instagram", "facebook", "threads", "tiktok", "pinterest"
]);
export type Platform = z.infer<typeof Platform>;

export const BlueskyAccount = z.object({
  platform: z.literal("bluesky"),
  identifier: z
    .string()
    .min(1)
    .describe("Bluesky handle (e.g. alice.bsky.social) or email"),
  appPassword: z
    .string()
    .min(1)
    .describe("Bluesky app password (not the account password)"),
});
export type BlueskyAccount = z.infer<typeof BlueskyAccount>;

export const Account = z.discriminatedUnion("platform", [BlueskyAccount]);
export type Account = z.infer<typeof Account>;
