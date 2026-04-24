import type { CreatePostResponse } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import type { Publisher } from "../_shared/publisher.js";
import { PinterestClient } from "./client.js";
import {
  assertPinterestUrlsReachable,
  validatePinterestInput,
  type PinterestPublishInput,
} from "./preflight.js";

/**
 * Credentials the Pinterest publisher needs. Token comes from the
 * platform_accounts.token column (decrypted at the repository boundary).
 * TODO(phase-11): handle proactive refresh when expiresAt is near.
 */
export type PinterestCredentials = {
  /** Pinterest access token (OAuth 2.0 bearer). */
  accessToken: string;
  /** Override the API base — tests point at MSW. */
  apiBase?: string;
};

export const pinterestPublisher: Publisher<
  PinterestCredentials,
  PinterestPublishInput
> = {
  async publish(creds, input): Promise<CreatePostResponse> {
    // Preflight (pure) before any network call.
    validatePinterestInput(input);

    // URL reachability + mime / size preflight — requires network but still
    // happens before we call Pinterest.
    await assertPinterestUrlsReachable({
      destinationUrl: input.destinationUrl,
      imageUrl: input.imageUrl,
    });

    const client = new PinterestClient(
      creds.accessToken,
      creds.apiBase,
    );

    const createArgs: Parameters<PinterestClient["createPin"]>[0] = {
      boardId: input.boardId,
      destinationUrl: input.destinationUrl,
      imageUrl: input.imageUrl,
    };
    if (input.title !== undefined) createArgs.title = input.title;
    if (input.text !== undefined) createArgs.description = input.text;

    const pin = await client.createPin(createArgs);

    if (!pin.id) {
      // Shouldn't happen — the client already validates; keep a loud fallback.
      throw new LetmepostError({
        code: "platform_rejected",
        status: 502,
        message: "Pinterest did not return a pin id.",
        platform: "pinterest",
      });
    }

    const response: CreatePostResponse = {
      id: pin.id,
      platform: "pinterest",
      uri: pin.link ?? `https://www.pinterest.com/pin/${pin.id}/`,
      createdAt: new Date().toISOString(),
    };
    return response;
  },
};
