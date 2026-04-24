import type { MediaInput } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";

/**
 * A `MediaInput` resolved to actual bytes + a definite mime type. Preflight
 * size checks run on this shape — never on the URL or base64 string — so
 * the byte count is honest regardless of how the caller supplied the media.
 */
export type LoadedMediaItem = {
  kind: "image" | "video";
  mimeType: string;
  byteLength: number;
  bytes: Uint8Array;
  altText?: string;
};

export type LoadMediaOptions = {
  /**
   * Platform tag stamped on errors so the user gets a `platform` field on the
   * error response (helps the dashboard's Post Log filter by platform).
   */
  platform?: string;
  /**
   * Rule slug for the "URL returned non-2xx" preflight failure. Each
   * platform owns its own rule namespace — e.g. `twitter.media.reachable`,
   * `bluesky.media.reachable`. Falls back to a generic message if omitted.
   */
  reachableRule?: string;
};

/**
 * Resolve a `MediaInput` (URL or inline base64) into bytes + mime type.
 * Errors are mapped to the canonical `LetmepostError` contract so callers
 * never have to re-translate.
 *
 *   - inline base64    → decoded; mime defaults to `image/jpeg` or
 *                        `video/mp4` based on `kind` (caller usually owns
 *                        the actual mime via the platform's preflight)
 *   - URL              → fetched; on non-2xx → `preflight_failed`; on
 *                        network failure → `platform_unavailable`
 *   - neither          → `validation_failed` (Zod refinement should catch
 *                        this; loud fallback)
 */
export async function loadMediaItem(
  item: MediaInput,
  opts: LoadMediaOptions = {},
): Promise<LoadedMediaItem> {
  if (item.bytesBase64) {
    const bytes = Uint8Array.from(Buffer.from(item.bytesBase64, "base64"));
    const mimeType =
      item.kind === "image" ? "image/jpeg" : "video/mp4";
    return withAlt(
      { kind: item.kind, mimeType, byteLength: bytes.byteLength, bytes },
      item.altText,
    );
  }

  if (!item.url) {
    throw new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: "Media item must provide either 'url' or 'bytesBase64'.",
      ...(opts.platform ? { platform: opts.platform } : {}),
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
      ...(opts.platform ? { platform: opts.platform } : {}),
      remediation:
        "Verify the media URL is publicly reachable, or inline via bytesBase64.",
    });
  }
  if (!res.ok) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Media URL returned ${res.status}: ${item.url}`,
      ...(opts.platform ? { platform: opts.platform } : {}),
      ...(opts.reachableRule ? { rule: opts.reachableRule } : {}),
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

  return withAlt(
    { kind: item.kind, mimeType, byteLength: bytes.byteLength, bytes },
    item.altText,
  );
}

function withAlt(
  base: Omit<LoadedMediaItem, "altText">,
  altText: string | undefined,
): LoadedMediaItem {
  return altText !== undefined ? { ...base, altText } : base;
}
