import {
  THREADS_ALT_TEXT_MAX_GRAPHEMES,
  THREADS_IMAGE_MAX_BYTES,
  THREADS_MAX_CAROUSEL,
  THREADS_MAX_GRAPHEMES,
  THREADS_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertMaxBytes,
  assertMaxGraphemes,
  countGraphemes,
} from "../_shared/preflight.js";

export { countGraphemes };

const PLATFORM = "threads";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_VIDEO_MIMES = new Set<string>([
  "video/mp4",
  "video/quicktime", // .mov
]);

/**
 * Validate the post body shape:
 *   - 0 media → TEXT post; text is required.
 *   - 1 media → single IMAGE or VIDEO; text is optional.
 *   - 2..20 media → CAROUSEL; text is optional, mixed image+video allowed.
 *   - >20 media → preflight_failed.
 *
 * Threads, unlike Bluesky, allows mixed images + videos in a single carousel.
 * We still cap at 20 children per Threads docs (`THREADS_MAX_CAROUSEL`).
 */
export function validateThreadsText(text: string, mediaCount: number): void {
  if (mediaCount === 0) {
    if (text.trim().length === 0) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message:
          "Threads text-only posts require non-empty text — pass `media: [...]` for an image/video/carousel.",
        rule: "threads.text.required",
        platform: PLATFORM,
        remediation:
          "Provide non-whitespace `text`, or include at least one media item.",
      });
    }
  }
  // Length cap applies regardless of post type — a 700-character caption on
  // an image post is rejected upstream too. Validate locally first so the
  // user sees a clean preflight error with no upstream round-trip.
  assertMaxGraphemes(text, THREADS_MAX_GRAPHEMES, {
    rule: "threads.text.max_graphemes",
    platform: PLATFORM,
  });
}

/**
 * A single media item AFTER the publisher has resolved it to bytes / mime
 * (for the inline + bytesBase64 paths) or just URL + mime (for `mediaId` /
 * raw `url` paths where Threads consumes a URL directly). The size + mime
 * checks fire only when bytes are actually known.
 */
export interface ResolvedMediaItem {
  kind: "image" | "video";
  altText?: string;
  mimeType: string;
  /** byteLength is unknown for raw URL inputs — undefined skips the size check. */
  byteLength?: number;
}

/**
 * Pre-resolve checks: count, alt-text length, carousel min-size. These
 * don't need resolved bytes, so we run them BEFORE fetching/HEAD-ing media
 * so a 25-image overflow fails immediately instead of after 25 round-trips.
 */
export interface ShapeCheckItem {
  kind: "image" | "video";
  altText?: string;
}

export function validateThreadsMediaShape(media: ShapeCheckItem[]): void {
  if (media.length === 0) return;

  if (media.length > THREADS_MAX_CAROUSEL) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${media.length} media items; Threads allows at most ${THREADS_MAX_CAROUSEL} per carousel.`,
      rule: "threads.media.count_max",
      platform: PLATFORM,
      remediation: `Reduce to ${THREADS_MAX_CAROUSEL} items or fewer, or split into multiple posts.`,
    });
  }

  for (const item of media) {
    if (item.altText !== undefined) {
      const count = countGraphemes(item.altText);
      if (count > THREADS_ALT_TEXT_MAX_GRAPHEMES) {
        throw new LetmepostError({
          code: "preflight_failed",
          status: 400,
          message: `Alt text is ${count} graphemes; Threads allows at most ${THREADS_ALT_TEXT_MAX_GRAPHEMES}.`,
          rule: "threads.media.alt_text_max_graphemes",
          platform: PLATFORM,
          remediation: `Shorten alt text to ${THREADS_ALT_TEXT_MAX_GRAPHEMES} graphemes or fewer.`,
        });
      }
    }
  }
}

/**
 * Mime + size checks for resolved media. Runs after `validateThreadsMediaShape`
 * — that one's covered the cheap stuff. This function is a no-op when bytes
 * are unknown (raw `url` inputs without a HEAD probe), since Threads will
 * reject bad media on its own and we can't pre-validate without the bytes.
 * The `mediaId` path always provides both, so production paths stay honest.
 */
export function validateThreadsMedia(media: ResolvedMediaItem[]): void {
  if (media.length === 0) return;
  validateThreadsMediaShape(media);

  for (const item of media) {
    if (item.kind === "image" && !ALLOWED_IMAGE_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Image mime type '${item.mimeType}' is not allowed on Threads.`,
        rule: "threads.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_IMAGE_MIMES].join(", ")}.`,
      });
    }
    if (item.kind === "video" && !ALLOWED_VIDEO_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video mime type '${item.mimeType}' is not allowed on Threads.`,
        rule: "threads.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_VIDEO_MIMES].join(", ")} (Threads accepts MP4 and MOV).`,
      });
    }

    if (item.byteLength !== undefined) {
      if (item.kind === "image") {
        assertMaxBytes(item.byteLength, THREADS_IMAGE_MAX_BYTES, {
          rule: "threads.media.image_size_max",
          platform: PLATFORM,
          subject: "Image",
          remediation: `Re-encode the image under ${THREADS_IMAGE_MAX_BYTES} bytes (Threads's per-image limit is 8 MB).`,
        });
      } else {
        assertMaxBytes(item.byteLength, THREADS_VIDEO_MAX_BYTES, {
          rule: "threads.media.video_size_max",
          platform: PLATFORM,
          subject: "Video",
          remediation: `Compress the video under ${THREADS_VIDEO_MAX_BYTES} bytes (Threads's per-video limit is 1 GB).`,
        });
      }
    }
  }
}
