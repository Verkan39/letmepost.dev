import {
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_MAX_CAROUSEL,
  INSTAGRAM_MAX_GRAPHEMES,
  INSTAGRAM_MIN_CAROUSEL,
  INSTAGRAM_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertMaxBytes,
  assertMaxGraphemes,
  countGraphemes,
} from "../_shared/preflight.js";

export { countGraphemes };

const PLATFORM = "instagram";

/**
 * Instagram is the strictest in the trio on mime types. JPEG-only for
 * photos: PNG / WebP / HEIC / GIF will all surface as `code 100, error
 * subcode 2207003` (or similar) on the create-container call. Pre-rejecting
 * here saves the user a confusing roundtrip — and gives them a remediation
 * pointing at /v1/media (which can transcode in a future slice).
 */
const ALLOWED_IMAGE_MIMES = new Set<string>(["image/jpeg"]);
const ALLOWED_VIDEO_MIMES = new Set<string>([
  "video/mp4",
  "video/quicktime",
]);

/**
 * IG post shape:
 *   - 0 media → REJECT. IG has no "text-only" surface on the API.
 *   - 1 image → IMAGE container.
 *   - 1 video → VIDEO or REELS container (we use REELS since IG retired
 *               the legacy IGTV / VIDEO product separation in 2024).
 *   - 2..10   → CAROUSEL (Threads allows 20; IG caps at 10).
 *   - >10     → preflight_failed.
 */
export function validateInstagramText(text: string, mediaCount: number): void {
  if (mediaCount === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Instagram does not support text-only posts. Attach at least one image or video via `media: [...]`.",
      rule: "instagram.media.required",
      platform: PLATFORM,
      remediation:
        "Provide a media item — Instagram's API has no text-only feed surface.",
    });
  }
  // Caption is optional on IG, but if present it must be ≤ 2200.
  if (text.trim().length === 0) return;
  assertMaxGraphemes(text, INSTAGRAM_MAX_GRAPHEMES, {
    rule: "instagram.text.max_graphemes",
    platform: PLATFORM,
  });
}

export interface ShapeCheckItem {
  kind: "image" | "video";
  altText?: string;
}

export function validateInstagramMediaShape(media: ShapeCheckItem[]): void {
  if (media.length === 0) return;

  if (media.length > INSTAGRAM_MAX_CAROUSEL) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${media.length} media items; Instagram allows at most ${INSTAGRAM_MAX_CAROUSEL} per carousel.`,
      rule: "instagram.media.count_max",
      platform: PLATFORM,
      remediation: `Reduce to ${INSTAGRAM_MAX_CAROUSEL} items or fewer.`,
    });
  }

  // Carousels can mix images + videos on Instagram (since the v15 API).
  // Single-item posts use IMAGE or REELS depending on kind. Either way,
  // we don't need an exclusivity check like Bluesky's.

  for (const item of media) {
    if (item.altText !== undefined && countGraphemes(item.altText) > 2_200) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: "Instagram alt text is capped at 2200 characters.",
        rule: "instagram.media.alt_text_max_graphemes",
        platform: PLATFORM,
        remediation: "Shorten the alt text to 2200 characters or fewer.",
      });
    }
  }
}

/**
 * Distinguish single-item vs. carousel — the publisher needs to pick
 * IMAGE/REELS vs. CAROUSEL container types. Returns the canonical
 * container shape rather than `enum`-style strings to keep the publisher
 * matchable.
 */
export type InstagramPostShape =
  | { kind: "single-image" }
  | { kind: "single-video" }
  | { kind: "carousel"; childCount: number };

export function classifyInstagramPost(
  media: { kind: "image" | "video" }[],
): InstagramPostShape {
  if (media.length === 1) {
    return media[0]!.kind === "image"
      ? { kind: "single-image" }
      : { kind: "single-video" };
  }
  // count_max already enforced upstream; lower bound is implicit (length>=2).
  if (media.length < INSTAGRAM_MIN_CAROUSEL) {
    // Defensive: should be unreachable since classify is only called after
    // validateInstagramText (which rejects 0) and we have a single-item
    // branch above. If we hit it, treat as single-image.
    return { kind: "single-image" };
  }
  return { kind: "carousel", childCount: media.length };
}

export interface ResolvedMediaItem {
  kind: "image" | "video";
  mimeType: string;
  byteLength?: number;
  altText?: string;
}

export function validateInstagramMedia(media: ResolvedMediaItem[]): void {
  if (media.length === 0) return;
  validateInstagramMediaShape(media);

  for (const item of media) {
    if (item.kind === "image" && !ALLOWED_IMAGE_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Image mime '${item.mimeType}' is not accepted by Instagram (JPEG only).`,
        rule: "instagram.media.mime_allowed",
        platform: PLATFORM,
        remediation:
          "Re-encode to JPEG. Instagram's container endpoint rejects PNG, WebP, HEIC, and GIF on the photo path.",
      });
    }
    if (item.kind === "video" && !ALLOWED_VIDEO_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video mime '${item.mimeType}' is not accepted by Instagram.`,
        rule: "instagram.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_VIDEO_MIMES].join(", ")}.`,
      });
    }

    if (item.byteLength !== undefined) {
      if (item.kind === "image") {
        assertMaxBytes(item.byteLength, INSTAGRAM_IMAGE_MAX_BYTES, {
          rule: "instagram.media.image_size_max",
          platform: PLATFORM,
          subject: "Image",
          remediation: `Compress the image under ${INSTAGRAM_IMAGE_MAX_BYTES} bytes (Instagram's photo container limit is 8 MB).`,
        });
      } else {
        assertMaxBytes(item.byteLength, INSTAGRAM_VIDEO_MAX_BYTES, {
          rule: "instagram.media.video_size_max",
          platform: PLATFORM,
          subject: "Video",
          remediation: `Compress the video under ${INSTAGRAM_VIDEO_MAX_BYTES} bytes (Instagram Reels accepts up to 1 GB).`,
        });
      }
    }
  }
}
