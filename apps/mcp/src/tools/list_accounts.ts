import { z } from "zod";
import type { ClientConfig } from "../client.js";
import { apiFetch } from "../client.js";

export const ListAccountsInputSchema = z.object({
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
      "Filter to a single platform. Omit to list every connected account on the org/profile scoped to this API key.",
    ),
});

export type ListAccountsInput = z.infer<typeof ListAccountsInputSchema>;

export async function runListAccounts(
  config: ClientConfig,
  input: ListAccountsInput,
): Promise<unknown> {
  const qs = input.platform ? `?platform=${input.platform}` : "";
  const res = await apiFetch(config, `/v1/accounts${qs}`);
  return res.body;
}
