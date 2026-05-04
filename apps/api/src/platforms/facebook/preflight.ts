import {
  FACEBOOK_IMAGE_MAX_BYTES,
  FACEBOOK_MAX_GRAPHEMES,
  FACEBOOK_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertMaxBytes,
  assertMaxGraphemes,
} from "../_shared/preflight.js";

const PLATFORM = "facebook";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const ALLOWED_VIDEO_MIMES = new Set<string>([
  "video/mp4",
  "video/quicktime",
]);

/**
 * Validate the post body shape. FB Pages let you post:
 *   - text only         → /feed with `message`
 *   - text + 1 photo    → /photos with caption
 *   - text + 1 video    → /videos with description
 *   - text + N photos   → /photos x N (unpublished) + /feed with attached_media
 *
 * Mixing image + video, or multiple videos, isn't supported on a single
 * Page post — fail at preflight with clear remediation rather than letting
 * Meta return a code-100 mid-publish.
 */
export function validateFacebookText(text: string, mediaCount: number): void {
  if (mediaCount === 0 && text.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Facebook text-only posts require non-empty text — pass `media: [...]` for a photo/video post.",
      rule: "facebook.text.required",
      platform: PLATFORM,
      remediation:
        "Provide non-whitespace `text`, or include at least one media item.",
    });
  }
  assertMaxGraphemes(text, FACEBOOK_MAX_GRAPHEMES, {
    rule: "facebook.text.max_graphemes",
    platform: PLATFORM,
  });
}

export interface ShapeCheckItem {
  kind: "image" | "video";
}

export function validateFacebookMediaShape(media: ShapeCheckItem[]): void {
  if (media.length === 0) return;

  const images = media.filter((m) => m.kind === "image");
  const videos = media.filter((m) => m.kind === "video");

  if (images.length > 0 && videos.length > 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Facebook Pages do not support mixed image + video on a single post.",
      rule: "facebook.media.image_video_exclusive",
      platform: PLATFORM,
      remediation:
        "Split into separate posts: one with photos, one with the video.",
    });
  }
  if (videos.length > 1) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Attached ${videos.length} videos; Facebook allows at most 1 per post.`,
      rule: "facebook.media.count_max",
      platform: PLATFORM,
      remediation: "Attach a single video, or split across multiple posts.",
    });
  }
}

export interface ResolvedMediaItem {
  kind: "image" | "video";
  mimeType: string;
  byteLength?: number;
}

export function validateFacebookMedia(media: ResolvedMediaItem[]): void {
  if (media.length === 0) return;
  validateFacebookMediaShape(media);

  for (const item of media) {
    if (item.kind === "image" && !ALLOWED_IMAGE_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Image mime '${item.mimeType}' is not accepted by Facebook.`,
        rule: "facebook.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_IMAGE_MIMES].join(", ")}.`,
      });
    }
    if (item.kind === "video" && !ALLOWED_VIDEO_MIMES.has(item.mimeType)) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Video mime '${item.mimeType}' is not accepted by Facebook.`,
        rule: "facebook.media.mime_allowed",
        platform: PLATFORM,
        remediation: `Use one of: ${[...ALLOWED_VIDEO_MIMES].join(", ")}.`,
      });
    }

    if (item.byteLength !== undefined) {
      if (item.kind === "image") {
        assertMaxBytes(item.byteLength, FACEBOOK_IMAGE_MAX_BYTES, {
          rule: "facebook.media.image_size_max",
          platform: PLATFORM,
          subject: "Image",
          remediation: `Re-encode the image under ${FACEBOOK_IMAGE_MAX_BYTES} bytes (Facebook's photo upload limit is ~4 MB).`,
        });
      } else {
        assertMaxBytes(item.byteLength, FACEBOOK_VIDEO_MAX_BYTES, {
          rule: "facebook.media.video_size_max",
          platform: PLATFORM,
          subject: "Video",
          remediation: `Compress the video under ${FACEBOOK_VIDEO_MAX_BYTES} bytes (Facebook's per-video limit is 4 GB).`,
        });
      }
    }
  }
}
