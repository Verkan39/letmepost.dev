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

// Threads (Threads Graph API v1.0, standalone OAuth at threads.net).
// Caller-facing limits are taken from Meta's published Threads API docs;
// values that are absent from the docs (alt-text grapheme cap) match the
// nearest analogue (Bluesky) so callers don't see surprising platform
// disparities for the same media payload.
export const THREADS_MAX_GRAPHEMES = 500;
export const THREADS_MIN_CAROUSEL = 2;
export const THREADS_MAX_CAROUSEL = 20;
export const THREADS_IMAGE_MAX_BYTES = 8_000_000;
export const THREADS_VIDEO_MAX_BYTES = 1_000_000_000;
export const THREADS_ALT_TEXT_MAX_GRAPHEMES = 1000;

// Facebook Pages (Graph API, Facebook Login for Business).
// FB's hard server-side cap on a Page post is 63,206 chars, and the API
// will reject with code 100 above that. We pre-check at 63,206 graphemes
// (close enough; FB's counter is UTF-16 codeunits but graphemes ≤ codeunits
// so we never over-permit a payload that would 100 upstream).
export const FACEBOOK_MAX_GRAPHEMES = 63_206;
export const FACEBOOK_IMAGE_MAX_BYTES = 4_000_000; // photo upload via /photos
export const FACEBOOK_VIDEO_MAX_BYTES = 4_000_000_000; // /videos endpoint accepts up to 4GB

// Instagram Business (Graph API). All Instagram publishing goes through
// the two-step container flow: create with media_url → poll status →
// publish. URLs MUST be publicly reachable; private/Drive URLs surface
// as `OAuthException 2207052`, the canonical opaque-rejection in the
// research corpus.
export const INSTAGRAM_MAX_GRAPHEMES = 2_200;
export const INSTAGRAM_MIN_CAROUSEL = 2;
export const INSTAGRAM_MAX_CAROUSEL = 10;
// JPEG only on Instagram (PNG/WebP/HEIC etc. are rejected). Container size
// limit is documented at 8 MB on the photo endpoint.
export const INSTAGRAM_IMAGE_MAX_BYTES = 8_000_000;
// Reels: 9:16 aspect, MP4/MOV, ≤ 90s, ≤ 1 GB, codec H.264 + AAC. We
// enforce size + mime at preflight; aspect/duration require a probe step
// (deferred — would need ffprobe in the worker).
export const INSTAGRAM_VIDEO_MAX_BYTES = 1_000_000_000;
export const INSTAGRAM_REELS_MAX_DURATION_SECONDS = 90;

/**
 * A single media item on a post. The caller provides bytes via one of three
 * sources:
 *   - `mediaId`     — references a prior `POST /v1/media` upload. Preferred
 *                     for production: the bytes already live on our CDN, so
 *                     publish-time latency drops by the upload roundtrip.
 *   - `url`         — passthrough; publisher fetches from a third-party CDN.
 *                     Useful for callers who already host their own assets.
 *   - `bytesBase64` — inline. Convenient for tiny images and tests; do not
 *                     use for video — multipart upload via `POST /v1/media`
 *                     is the only sane path past a few MB.
 *
 * Exactly one of the three must be set on each item.
 */
export const MEDIA_ID_PATTERN = /^med_[0-9A-Za-z]{22}$/;

const MediaSource = z
  .object({
    mediaId: z.string().regex(MEDIA_ID_PATTERN).optional(),
    url: z.string().url().optional(),
    bytesBase64: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      (v.mediaId ? 1 : 0) + (v.url ? 1 : 0) + (v.bytesBase64 ? 1 : 0) === 1,
    {
      message:
        "Exactly one of 'mediaId', 'url', or 'bytesBase64' must be provided for each media item.",
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

/**
 * Response shape for `POST /v1/media`. The `id` is what callers reference
 * back from `media: [{ kind, mediaId }]` on a post body. `url` is the
 * resolved public URL — provided so callers that prefer to send `{ url }`
 * to other systems (or just want to render a preview) don't have to
 * reconstruct it.
 */
export const CreateMediaResponse = z.object({
  id: z.string().regex(MEDIA_ID_PATTERN),
  url: z.string().url(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
});
export type CreateMediaResponse = z.infer<typeof CreateMediaResponse>;

export const FirstComment = z.object({
  text: z.string().min(1),
});
export type FirstComment = z.infer<typeof FirstComment>;

/**
 * Per-post Pinterest extension — the documented escape hatch for callers
 * who want to override the connected account's default board, set a
 * specific click-through URL, or stamp a pin title. All fields optional;
 * omit the whole object to publish to the account's `defaultBoardId` with
 * the image URL as the click-through.
 */
export const PinterestPostOverrides = z.object({
  boardId: z.string().min(1).optional(),
  destinationUrl: z.string().url().optional(),
  title: z.string().min(1).optional(),
});
export type PinterestPostOverrides = z.infer<typeof PinterestPostOverrides>;

/**
 * Per-post Threads extension. `replyToId` is the platform thread id to
 * reply under (Threads's `reply_to_id` parameter). Threads doesn't have
 * scheduled-publish or first-comment, so the surface stays minimal.
 */
export const ThreadsPostOverrides = z.object({
  replyToId: z.string().min(1).optional(),
});
export type ThreadsPostOverrides = z.infer<typeof ThreadsPostOverrides>;

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
  /** Pinterest-specific overrides — board, destination URL, title. */
  pinterest: PinterestPostOverrides.optional(),
  /** Threads-specific overrides — reply_to_id. */
  threads: ThreadsPostOverrides.optional(),
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
