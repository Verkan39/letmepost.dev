import type { BlueskyAccount, CreatePostResponse } from "@letmepost/schemas";
import type { Publisher } from "../_shared/publisher.js";
import { BlueskyClient } from "./client.js";
import { validateBlueskyText } from "./preflight.js";

export const blueskyPublisher: Publisher<BlueskyAccount, string> = {
  async publish(account, text): Promise<CreatePostResponse> {
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
  },
};
