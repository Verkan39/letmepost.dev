import type { BlueskyAccount, CreatePostResponse } from "@letmepost/schemas";
import { BlueskyClient } from "./client.js";
import { validateBlueskyText } from "./preflight.js";

export async function publishToBluesky(
  account: BlueskyAccount,
  text: string,
): Promise<CreatePostResponse> {
  validateBlueskyText(text);
  const client = new BlueskyClient(account.identifier, account.appPassword);
  const session = await client.createSession();
  const { uri, cid } = await client.createPost(session, text);
  return {
    id: cid,
    platform: "bluesky",
    uri,
    cid,
    createdAt: new Date().toISOString(),
  };
}
