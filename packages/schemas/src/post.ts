import { z } from "zod";
import { AccountRef } from "./platforms.js";
import { PostStatus } from "./post-status.js";

export const BLUESKY_MAX_GRAPHEMES = 300;
export const BLUESKY_MAX_IMAGES = 4;
export const BLUESKY_IMAGE_MAX_BYTES = 1_000_000;
export const BLUESKY_VIDEO_MAX_BYTES = 100_000_000;
export const BLUESKY_ALT_TEXT_MAX_GRAPHEMES = 2000;

// Pinterest (v5 API, OAuth 2.0). MVP: single-image pin from URL only.
export const PINTEREST_IMAGE_MAX_BYTES = 20_000_000;

// LinkedIn (Versioned REST API, OAuth 2.0 3-legged).
// LinkedIn's "ugcPost" / "/rest/posts" commentary cap is 3,000 graphemes.
// Emoji + ZWJ sequences count as 1 grapheme — same counter we use elsewhere.
export const LINKEDIN_MAX_GRAPHEMES = 3000;

// Twitter / X (v2 API, OAuth 2.0 PKCE).
// t.co wraps every URL to a fixed length regardless of the real URL length —
// the counter subtracts the real URL length and adds this constant.
export const TWITTER_MAX_GRAPHEMES = 280;
export const TWITTER_TCO_URL_LENGTH = 23;
export const TWITTER_IMAGE_MAX_BYTES = 5_000_000;
export const TWITTER_GIF_MAX_BYTES = 15_000_000;
export const TWITTER_VIDEO_MAX_BYTES = 512_000_000;

/**
 * A single media item on a post. The caller provides bytes either inline
 * (`bytesBase64`) or by URL (`url`) — the publisher resolves to bytes before
 * running size preflight. Exactly one of the two must be set.
 */
const MediaSource = z
  .object({
    url: z.string().url().optional(),
    bytesBase64: z.string().min(1).optional(),
  })
  .refine(
    (v) => (v.url ? 1 : 0) + (v.bytesBase64 ? 1 : 0) === 1,
    {
      message:
        "Exactly one of 'url' or 'bytesBase64' must be provided for each media item.",
    },
  );

const MediaImage = z
  .object({
    kind: z.literal("image"),
    altText: z.string().optional(),
  })
  .and(MediaSource);

const MediaVideo = z
  .object({
    kind: z.literal("video"),
    altText: z.string().optional(),
  })
  .and(MediaSource);

export const MediaInput = z.union([MediaImage, MediaVideo]);
export type MediaInput = z.infer<typeof MediaInput>;

export const FirstComment = z.object({
  text: z.string().min(1),
});
export type FirstComment = z.infer<typeof FirstComment>;

export const CreatePostRequest = z.object({
  account: AccountRef,
  text: z.string().min(1),
  media: z.array(MediaInput).optional(),
  firstComment: FirstComment.optional(),
  /**
   * ISO-8601 datetime. If set and in the future, the post is persisted with
   * status="queued" and a delayed job is scheduled on the publish queue —
   * the endpoint returns 202 immediately. If absent, the post runs
   * synchronously and returns 201.
   */
  scheduledAt: z.string().datetime().optional(),
});
export type CreatePostRequest = z.infer<typeof CreatePostRequest>;

export const CreatePostResponse = z.object({
  id: z.string(),
  platform: z.string(),
  /**
   * Lifecycle state — "queued" for scheduled posts (returned with 202),
   * "published" for successful immediate posts (returned with 201).
   */
  status: PostStatus.optional(),
  uri: z.string().optional(),
  cid: z.string().optional(),
  createdAt: z.string(),
  /** Echoed back on scheduled posts so callers can confirm the parse. */
  scheduledAt: z.string().optional(),
  firstCommentUri: z.string().optional(),
  firstCommentCid: z.string().optional(),
  /**
   * Non-fatal warnings attached to an otherwise successful publish. Today,
   * used when the main post succeeded but the first-comment reply failed —
   * we surface a warning rather than fail the whole request.
   */
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});
export type CreatePostResponse = z.infer<typeof CreatePostResponse>;
