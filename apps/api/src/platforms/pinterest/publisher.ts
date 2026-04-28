import type { CreatePostResponse } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  resolveMediaToUrl,
  type MediaResolverContext,
} from "../_shared/media.js";
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
 */
export type PinterestCredentials = {
  /** Pinterest access token (OAuth 2.0 bearer). */
  accessToken: string;
  /** Override the API base — tests point at MSW. */
  apiBase?: string;
};

export const pinterestPublisher: Publisher<
  PinterestCredentials,
  PinterestPublishInput & { mediaContext?: MediaResolverContext }
> = {
  async publish(creds, input): Promise<CreatePostResponse> {
    // Pure preflight (board / media presence / kind) before any network.
    validatePinterestInput(input);

    // Resolve the single media item to a public URL. mediaId → S3 URL,
    // url → passthrough, bytesBase64 → preflight_failed (caller should hit
    // /v1/media first). The resolver is the only place mediaId tenancy is
    // enforced; rejected ids 404 here, never leak existence.
    const mediaItem = input.media[0]!;
    const resolved = await resolveMediaToUrl(mediaItem, {
      platform: "pinterest",
      reachableRule: "pinterest.media.reachable",
      ...(input.mediaContext
        ? {
            db: input.mediaContext.db,
            organizationId: input.mediaContext.organizationId,
            profileId: input.mediaContext.profileId,
          }
        : {}),
    });

    // URL reachability + mime / size preflight on the resolved URL.
    const reachableArgs: Parameters<typeof assertPinterestUrlsReachable>[0] = {
      imageUrl: resolved.url,
    };
    if (input.destinationUrl) reachableArgs.destinationUrl = input.destinationUrl;
    await assertPinterestUrlsReachable(reachableArgs);

    const client = new PinterestClient(
      creds.accessToken,
      creds.apiBase,
    );

    const createArgs: Parameters<PinterestClient["createPin"]>[0] = {
      boardId: input.boardId,
      // Pinterest's `link` is optional in v5 — fall back to the image URL so
      // the pin still has a click destination instead of a dead pin.
      destinationUrl: input.destinationUrl ?? resolved.url,
      imageUrl: resolved.url,
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
