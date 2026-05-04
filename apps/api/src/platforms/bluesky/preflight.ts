import {
  BLUESKY_ALT_TEXT_MAX_GRAPHEMES,
  BLUESKY_IMAGE_MAX_BYTES,
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_IMAGES,
  BLUESKY_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertMaxBytes,
  assertMaxGraphemes,
  assertNonEmpty,
  countGraphemes,
} from "../_shared/preflight.js";

export { countGraphemes };

const PLATFORM = "bluesky";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const ALLOWED_VIDEO_MIMES = new Set<string>(["video/mp4"]);

export function validateBlueskyText(text: string): void {
  assertNonEmpty(text, {
    rule: "bluesky.text.non_empty",
    platform: PLATFORM,
  });
  assertMaxGraphemes(text, BLUESKY_MAX_GRAPHEMES, {
    rule: "bluesky.text.max_graphemes",
    platform: PLATFORM,
  });
}

/**
 * A single media item AFTER the publisher has resolved it to bytes. Preflight
 * is run on resolved bytes — not the URL or the base64 string — so the size
 * check is accurate regardless of how the caller supplied the content.
 */
export interface ResolvedMediaItem {
  kind: "image" | "video";
  altText?: string;
  mimeType: string;
  byteLength: number;
}

/**
 * Pre-resolve checks: count, exclusivity, alt-text length. These don't need
 * resolved bytes, so we run them BEFORE fetching media so a 5-image overflow
 * (or a 4001-grapheme alt text) fails immediately instead of after pulling
 * five JPEGs over the wire.
 */
export interface ShapeCheckItem {
  kind: "image" | "video";
  altText?: string;
}

export function validateBlueskyMediaShape(media: ShapeCheckItem[]): void {
  if (media.length === 0) return;

  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");

  if (images.length > 0 && videos.length > 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Cannot attach both images and video to the same Bluesky post; pick one.",
      rule: "bluesky.media.image_video_exclusive",
      platform: PLATFORM,
      remediation:
        "Split the post: images in one post, video in another. Bluesky does not support mixed media in a single record.",
    });
  }

  if (images.length > BLUESKY_MAX_IMAGES) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${images.length} images; Bluesky allows at most ${BLUESKY_MAX_IMAGES} per post.`,
      rule: "bluesky.media.count_max",
      platform: PLATFORM,
      remediation: `Reduce to ${BLUESKY_MAX_IMAGES} images or fewer.`,
    });
  }

  if (videos.length > 1) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${videos.length} videos; Bluesky allows at most 1 per post.`,
      rule: "bluesky.media.count_max",
      platform: PLATFORM,
      remediation: "Attach a single video.",
    });
  }

  for (const item of media) {
    if (item.altText !== undefined) {
      const count = countGraphemes(item.altText);
      if (count > BLUESKY_ALT_TEXT_MAX_GRAPHEMES) {
        throw new LetmepostError({
          code: "preflight_failed",
          status: 400,
          message: `Alt text is ${count} graphemes; Bluesky allows at most ${BLUESKY_ALT_TEXT_MAX_GRAPHEMES}.`,
          rule: "bluesky.media.alt_text_max_graphemes",
          platform: PLATFORM,
          remediation: `Shorten alt text to ${BLUESKY_ALT_TEXT_MAX_GRAPHEMES} graphemes or fewer.`,
        });
      }
    }
  }
}

export function validateBlueskyMedia(media: ResolvedMediaItem[]): void {
  if (media.length === 0) return;

  // Re-run the shape-only checks against the resolved set in case a future
  // caller skipped the pre-resolve pass. Cheap, and keeps this function
  // self-sufficient for tests.
  validateBlueskyMediaShape(media);

  for (const item of media) {
    if (item.kind === "image" && !ALLOWED_IMAGE_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Image mime type '${item.mimeType}' is not allowed on Bluesky.`,
        rule: "bluesky.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_IMAGE_MIMES].join(", ")}.`,
      });
    }
    if (item.kind === "video" && !ALLOWED_VIDEO_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video mime type '${item.mimeType}' is not allowed on Bluesky.`,
        rule: "bluesky.media.mime_allowed",
        platform: PLATFORM,
        remediation: "Bluesky currently supports mp4 video only.",
      });
    }

    if (item.kind === "image") {
      assertMaxBytes(item.byteLength, BLUESKY_IMAGE_MAX_BYTES, {
        rule: "bluesky.media.image_size_max",
        platform: PLATFORM,
        subject: "Image",
        remediation: `Re-encode the image under ${BLUESKY_IMAGE_MAX_BYTES} bytes (Bluesky's blob limit is ~976 KB).`,
      });
    } else {
      assertMaxBytes(item.byteLength, BLUESKY_VIDEO_MAX_BYTES, {
        rule: "bluesky.media.video_size_max",
        platform: PLATFORM,
        subject: "Video",
        remediation: `Compress the video under ${BLUESKY_VIDEO_MAX_BYTES} bytes (100 MB).`,
      });
    }

    // alt-text length is validated in validateBlueskyMediaShape above.
  }
}

export function validateBlueskyFirstComment(text: string): void {
  assertNonEmpty(text, {
    rule: "bluesky.first_comment.non_empty",
    platform: PLATFORM,
  });
  assertMaxGraphemes(text, BLUESKY_MAX_GRAPHEMES, {
    rule: "bluesky.first_comment.max_graphemes",
    platform: PLATFORM,
  });
}
