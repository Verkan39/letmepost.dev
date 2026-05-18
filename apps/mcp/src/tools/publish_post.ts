import { z } from "zod";
import type { ClientConfig } from "../client.js";
import { apiFetch } from "../client.js";

// Input shape matches the multi-target POST /v1/posts body. We keep the
// schema loose-but-typed so an agent can either pass a connected account id
// directly OR rely on single-account auto-resolution by platform.
const Target = z.object({
  accountId: z
    .string()
    .optional()
    .describe(
      "Connected account id (e.g. acc_...). Omit to let the API resolve the org's single connected account for the given platform.",
    ),
  platform: z
    .enum([
      "bluesky",
      "twitter",
      "linkedin",
      "threads",
      "instagram",
      "facebook",
      "pinterest",
    ])
    .optional()
    .describe(
      "Platform name. Required if accountId is omitted; ignored otherwise.",
    ),
  text: z
    .string()
    .optional()
    .describe(
      "Per-target text override. Falls back to the top-level text if omitted.",
    ),
});

export const PublishPostInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Default post text applied to every target that does not override it.",
    ),
  targets: z
    .array(Target)
    .min(1)
    .max(25)
    .describe(
      "One entry per destination. Each entry is either { accountId } or { platform }. Use { platform } when the org has a single connected account for that platform and you want the API to resolve it.",
    ),
  publishNow: z
    .boolean()
    .optional()
    .describe(
      "Defaults to true. Set false and provide scheduledAt to queue for later.",
    ),
  scheduledAt: z
    .string()
    .datetime()
    .optional()
    .describe("ISO-8601 datetime. Mutually exclusive with publishNow=true."),
});

export type PublishPostInput = z.infer<typeof PublishPostInputSchema>;

export async function runPublishPost(
  config: ClientConfig,
  input: PublishPostInput,
): Promise<unknown> {
  const res = await apiFetch(config, "/v1/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return res.body;
}
