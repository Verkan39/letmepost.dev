import type { CreatePostResponse, MediaInput } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
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
};

/**
 * Shared loader — identical semantics to the Bluesky publisher. Kept local
 * for now; if a third platform wants URL/base64 resolution we'll promote to
 * `platforms/_shared/media.ts`.
 */
async function loadMediaItem(
  item: MediaInput,
): Promise<{
  kind: "image" | "video";
  mimeType: string;
  byteLength: number;
  bytes: Uint8Array;
}> {
  if (item.bytesBase64) {
    const bytes = Uint8Array.from(Buffer.from(item.bytesBase64, "base64"));
    const mimeType =
      item.kind === "image" ? "image/jpeg" : "video/mp4";
    return {
      kind: item.kind,
      mimeType,
      byteLength: bytes.byteLength,
      bytes,
    };
  }
  if (!item.url) {
    throw new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: "Media item must provide either 'url' or 'bytesBase64'.",
    });
  }

  let res: Response;
  try {
    res = await fetch(item.url);
  } catch {
    throw new LetmepostError({
      code: "platform_unavailable",
      status: 503,
      message: `Failed to fetch media from ${item.url}.`,
      platform: "twitter",
      remediation: "Verify the media URL is publicly reachable.",
    });
  }
  if (!res.ok) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Media URL returned ${res.status}: ${item.url}`,
      rule: "twitter.media.reachable",
      platform: "twitter",
      remediation:
        "Ensure the URL is public and returns 200, or inline via bytesBase64.",
    });
  }
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const contentType = res.headers.get("content-type");
  const mimeType = contentType
    ? contentType.split(";")[0]!.trim().toLowerCase()
    : item.kind === "image"
      ? "image/jpeg"
      : "video/mp4";
  return {
    kind: item.kind,
    mimeType,
    byteLength: bytes.byteLength,
    bytes,
  };
}

export const twitterPublisher: Publisher<
  TwitterCredentials,
  TwitterPublishInput
> = {
  async publish(creds, input): Promise<CreatePostResponse> {
    const { text, media = [] } = input;

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

    const loaded = await Promise.all(media.map(loadMediaItem));
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
