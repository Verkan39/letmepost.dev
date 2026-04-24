import type { CreatePostResponse } from "@letmepost/schemas";
import type { Publisher } from "../_shared/publisher.js";
import { BlueskyClient } from "./client.js";
import { validateBlueskyText } from "./preflight.js";

/**
 * Credentials the Bluesky publisher needs to authenticate + post. Callers
 * resolve these from a stored platform_account via the repository — the
 * publisher never touches the DB directly.
 */
export type BlueskyCredentials = {
  /** Bluesky handle or email used at createSession time. */
  handle: string;
  /** Decrypted app password. */
  appPassword: string;
};

export const blueskyPublisher: Publisher<BlueskyCredentials, string> = {
  async publish(creds, text): Promise<CreatePostResponse> {
    validateBlueskyText(text);
    const client = new BlueskyClient(creds.handle, creds.appPassword);
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
