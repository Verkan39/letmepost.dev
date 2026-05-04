import {
  TWITTER_ALT_TEXT_MAX_GRAPHEMES,
  TWITTER_GIF_MAX_BYTES,
  TWITTER_IMAGE_MAX_BYTES,
  TWITTER_MAX_GRAPHEMES,
  TWITTER_MAX_IMAGES,
  TWITTER_TCO_URL_LENGTH,
  TWITTER_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertNonEmpty,
  countGraphemes,
} from "../_shared/preflight.js";

const PLATFORM = "twitter";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_GIF_MIMES = new Set<string>(["image/gif"]);
const ALLOWED_VIDEO_MIMES = new Set<string>(["video/mp4"]);

/**
 * URL-shortening-aware grapheme count. t.co wraps every URL — regardless of
 * the real length — to a fixed character count. Our counter subtracts the
 * raw URL length and adds {@link TWITTER_TCO_URL_LENGTH}, so a 300-char
 * shortlink costs the same 23 characters as a 30-char one.
 *
 * Matches X's real counter as documented at
 * https://developer.x.com/en/docs/counting-characters — good enough for MVP;
 * RFC-3987 IRIs and weird unicode-normalised hosts are the edge case we
 * consciously defer.
 */
export function countTwitterWeightedGraphemes(text: string): number {
  // Naive URL match covering http:// and https://. This is intentionally
  // generous about what counts as "the URL" — the weight adjustment is a
  // subtract-and-replace, so over-matching inside the URL just shifts which
  // codepoints are inside vs outside the 23-char block. Net weight is still
  // correct.
  const URL_RE = /https?:\/\/[^\s]+/gi;
  let total = countGraphemes(text);
  const matches = text.match(URL_RE);
  if (!matches) return total;
  for (const url of matches) {
    // Subtract the raw grapheme count of the URL, add the t.co weight.
    total -= countGraphemes(url);
    total += TWITTER_TCO_URL_LENGTH;
  }
  return total;
}

export function validateTwitterText(text: string): void {
  assertNonEmpty(text, {
    rule: "twitter.text.non_empty",
    platform: PLATFORM,
  });
  const weighted = countTwitterWeightedGraphemes(text);
  if (weighted > TWITTER_MAX_GRAPHEMES) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Tweet weight is ${weighted} graphemes (URL-shortened); X allows at most ${TWITTER_MAX_GRAPHEMES}.`,
      rule: "twitter.text.max_graphemes",
      platform: PLATFORM,
      remediation: `Shorten the tweet — every link counts as ${TWITTER_TCO_URL_LENGTH} characters regardless of length.`,
    });
  }
}

/**
 * A single media item resolved to bytes — used for mime + size preflight
 * independent of whether the caller supplied url or bytesBase64.
 */
export interface TwitterResolvedMediaItem {
  kind: "image" | "video";
  mimeType: string;
  byteLength: number;
  altText?: string;
}

/**
 * Pre-resolve checks on caller-provided shape: count + image/video
 * exclusivity + alt-text length. None of these need bytes, so failing
 * here saves a fetch storm when someone passes 5 image URLs.
 */
export interface TwitterShapeCheckItem {
  kind: "image" | "video";
  altText?: string;
}

export function validateTwitterMediaShape(
  items: readonly TwitterShapeCheckItem[],
): void {
  if (items.length === 0) return;

  const images = items.filter((m) => m.kind === "image");
  const videos = items.filter((m) => m.kind === "video");

  if (images.length > 0 && videos.length > 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Cannot attach both images and video to the same tweet — X requires picking one.",
      rule: "twitter.media.image_video_exclusive",
      platform: PLATFORM,
      remediation:
        "Split into separate tweets: one with images, one with the video.",
    });
  }
  if (videos.length > 1) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${videos.length} videos; X allows at most 1 per tweet.`,
      rule: "twitter.media.count_max",
      platform: PLATFORM,
      remediation: "Attach a single video.",
    });
  }
  if (images.length > TWITTER_MAX_IMAGES) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${images.length} images; X allows at most ${TWITTER_MAX_IMAGES} per tweet.`,
      rule: "twitter.media.count_max",
      platform: PLATFORM,
      remediation: `Reduce to ${TWITTER_MAX_IMAGES} images or fewer.`,
    });
  }

  for (const item of items) {
    if (item.altText !== undefined) {
      const count = countGraphemes(item.altText);
      if (count > TWITTER_ALT_TEXT_MAX_GRAPHEMES) {
        throw new LetmepostError({
          code: "preflight_failed",
          status: 400,
          message: `Alt text is ${count} graphemes; X allows at most ${TWITTER_ALT_TEXT_MAX_GRAPHEMES}.`,
          rule: "twitter.media.alt_text_max_graphemes",
          platform: PLATFORM,
          remediation: `Shorten alt text to ${TWITTER_ALT_TEXT_MAX_GRAPHEMES} graphemes or fewer.`,
        });
      }
    }
  }
}

export function validateTwitterMedia(
  items: readonly TwitterResolvedMediaItem[],
): void {
  if (items.length === 0) return;
  validateTwitterMediaShape(items);

  for (const item of items) {
    if (item.kind === "image") {
      const isGif = ALLOWED_GIF_MIMES.has(item.mimeType);
      const isStatic = ALLOWED_IMAGE_MIMES.has(item.mimeType);
      if (!isGif && !isStatic) {
        throw new LetmepostError({
          code: "preflight_failed",
          status: 400,
          message: `Image mime type '${item.mimeType}' is not allowed on X.`,
          rule: "twitter.media.mime_allowed",
          platform: PLATFORM,
          remediation: `Use one of: ${[...ALLOWED_IMAGE_MIMES, ...ALLOWED_GIF_MIMES].join(", ")}.`,
        });
      }
      const ceiling = isGif ? TWITTER_GIF_MAX_BYTES : TWITTER_IMAGE_MAX_BYTES;
      if (item.byteLength > ceiling) {
        throw new LetmepostError({
          code: "preflight_failed",
          status: 400,
          message: `Image is ${item.byteLength} bytes; X allows at most ${ceiling}.`,
          rule: isGif ? "twitter.media.gif_size_max" : "twitter.media.image_size_max",
          platform: PLATFORM,
          remediation: `Re-encode under ${ceiling} bytes.`,
        });
      }
      continue;
    }

    // Video.
    if (!ALLOWED_VIDEO_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video mime type '${item.mimeType}' is not allowed on X.`,
        rule: "twitter.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_VIDEO_MIMES].join(", ")}.`,
      });
    }
    if (item.byteLength > TWITTER_VIDEO_MAX_BYTES) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video is ${item.byteLength} bytes; X allows at most ${TWITTER_VIDEO_MAX_BYTES}.`,
        rule: "twitter.media.video_size_max",
        platform: PLATFORM,
        remediation: `Compress under ${TWITTER_VIDEO_MAX_BYTES} bytes.`,
      });
    }
  }
}

export { countGraphemes };
