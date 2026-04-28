import type { CreatePostResponse, MediaInput } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  loadMediaItem as sharedLoadMediaItem,
  type MediaResolverContext,
} from "../_shared/media.js";
import type { Publisher } from "../_shared/publisher.js";
import { TwitterClient } from "./client.js";
import {
  validateTwitterMedia,
  validateTwitterText,
  type TwitterResolvedMediaItem,
} from "./preflight.js";

export type TwitterCredentials = {
  /** OAuth 2.0 access token. */
  accessToken: string;
  /** Upstream user id (x.com `id`), surfaced in the response. */
  userId?: string;
  /** Override the API base — tests point at MSW. */
  apiBase?: string;
  /** Override the upload base — tests point at MSW. */
  uploadBase?: string;
};

export type TwitterPublishInput = {
  text: string;
  /** Single media item; MVP. */
  media?: MediaInput[];
  /** Required only if any media item references a `mediaId`. */
  mediaContext?: MediaResolverContext;
};

function loadMediaItem(
  item: MediaInput,
  ctx: MediaResolverContext | undefined,
) {
  return sharedLoadMediaItem(item, {
    platform: "twitter",
    reachableRule: "twitter.media.reachable",
    ...(ctx
      ? {
          db: ctx.db,
          organizationId: ctx.organizationId,
          profileId: ctx.profileId,
        }
      : {}),
  });
}

export const twitterPublisher: Publisher<
  TwitterCredentials,
  TwitterPublishInput
> = {
  async publish(creds, input): Promise<CreatePostResponse> {
    const { text, media = [], mediaContext } = input;

    validateTwitterText(text);

    // TODO(phase-8): threads, polls, quote-tweets, alt-text, multi-media.
    if (media.length > 1) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: "MVP supports a single media item on X tweets.",
        rule: "twitter.media.single_only",
        platform: "twitter",
        remediation:
          "Attach one media item; multi-media + threads land in a follow-up slice.",
      });
    }

    const loaded = await Promise.all(
      media.map((item) => loadMediaItem(item, mediaContext)),
    );
    validateTwitterMedia(
      loaded.map((l): TwitterResolvedMediaItem => {
        return {
          kind: l.kind,
          mimeType: l.mimeType,
          byteLength: l.byteLength,
        };
      }),
    );

    const client = new TwitterClient(
      creds.accessToken,
      creds.apiBase,
      creds.uploadBase,
    );

    const mediaIds: string[] = [];
    for (const item of loaded) {
      const id = await client.uploadMedia(item.bytes, item.mimeType);
      mediaIds.push(id);
    }

    const createArgs: Parameters<TwitterClient["createTweet"]>[0] = { text };
    if (mediaIds.length > 0) createArgs.mediaIds = mediaIds;
    const tweet = await client.createTweet(createArgs);

    const response: CreatePostResponse = {
      id: tweet.id,
      platform: "twitter",
      uri: creds.userId
        ? `https://twitter.com/${creds.userId}/status/${tweet.id}`
        : `https://twitter.com/i/web/status/${tweet.id}`,
      createdAt: new Date().toISOString(),
    };
    return response;
  },
};
