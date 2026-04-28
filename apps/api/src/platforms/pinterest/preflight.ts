import {
  PINTEREST_IMAGE_MAX_BYTES,
  type MediaInput,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import { platformFetch } from "../_shared/http.js";

const PLATFORM = "pinterest";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * The publisher's input shape after the Phase 7.5 rewrite. `boardId` is
 * resolved by the caller (publisher) — either from `pinterest.boardId` on
 * the request body or from `tokenMetadata.defaultBoardId` — so by the time
 * this preflight runs we have a definite value.
 */
export interface PinterestPublishInput {
  /** Pin description / caption. Maps to Pinterest's `description`. */
  text?: string;
  /** Resolved at the publisher: per-post override → account default. */
  boardId: string;
  /** Optional click-through URL. Pinterest's v5 makes this optional. */
  destinationUrl?: string;
  /** Optional pin title. */
  title?: string;
  /** Single media item — image MVP. Multi-image and video land in Phase 11. */
  media: MediaInput[];
}

/**
 * Pure preflight on caller-controlled fields. Image URL reachability is a
 * separate async step (the publisher runs it after this).
 */
export function validatePinterestInput(input: PinterestPublishInput): void {
  if (!input.boardId || input.boardId.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest pin requires a boardId.",
      rule: "pinterest.board.required",
      platform: PLATFORM,
      remediation:
        "Set a default board on the connected Pinterest account, or pass `pinterest: { boardId }` on the request body.",
    });
  }

  if (!input.media || input.media.length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest pins require exactly one media item.",
      rule: "pinterest.media.required",
      platform: PLATFORM,
      remediation:
        "Pass `media: [{ kind: \"image\", url | mediaId }]` on the request body.",
    });
  }
  if (input.media.length > 1) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest MVP supports a single media item per pin.",
      rule: "pinterest.media.single_only",
      platform: PLATFORM,
      remediation:
        "Send one media item; multi-image carousels + video pins land in Phase 11.",
    });
  }
  const item = input.media[0]!;
  if (item.kind !== "image") {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest MVP supports image pins only.",
      rule: "pinterest.media.image_only",
      platform: PLATFORM,
      remediation:
        "Use kind: \"image\". Video pins land in Phase 11 once core publishing is locked.",
    });
  }

  if (input.destinationUrl !== undefined) {
    assertHttpUrl(input.destinationUrl, "pinterest.destination_url.http");
  }
}

function assertHttpUrl(raw: string, rule: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `URL is not a valid absolute URL: ${raw}`,
      rule,
      platform: PLATFORM,
      remediation: "Provide an absolute http:// or https:// URL.",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `URL must use http or https: ${raw}`,
      rule,
      platform: PLATFORM,
      remediation: "Pinterest only accepts http/https URLs.",
    });
  }
}

/**
 * Fetch the destination + image URLs and confirm 2xx; on the image, also
 * check content-type + content-length against Pinterest's caps. Pinterest
 * docs put the single-image ceiling at 20 MB. Servers that don't return a
 * content-length are allowed through — Pinterest will do its own check.
 */
export async function assertPinterestUrlsReachable(input: {
  destinationUrl?: string;
  imageUrl: string;
}): Promise<void> {
  if (input.destinationUrl) {
    await fetchAndAssertOk(input.destinationUrl, {
      rule: "pinterest.destination_url.reachable",
      remediation:
        "Pinterest requires the destination URL to return 2xx; verify it is publicly reachable.",
    });
  }

  const imgRes = await fetchAndAssertOk(input.imageUrl, {
    rule: "pinterest.image_url.reachable",
    remediation:
      "Pinterest must be able to fetch the image URL; verify it is public and returns 2xx.",
  });

  const contentType = (imgRes.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (contentType && !ALLOWED_IMAGE_MIMES.has(contentType)) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Image mime type '${contentType}' is not allowed on Pinterest.`,
      rule: "pinterest.image.mime_allowed",
      platform: PLATFORM,
      remediation: `Use one of: ${[...ALLOWED_IMAGE_MIMES].join(", ")}.`,
    });
  }

  const lenHeader = imgRes.headers.get("content-length");
  if (lenHeader) {
    const size = Number.parseInt(lenHeader, 10);
    if (
      Number.isFinite(size) &&
      size > 0 &&
      size > PINTEREST_IMAGE_MAX_BYTES
    ) {
      throw new LetmepostError({
        code: "preflight_failed",
        status: 400,
        message: `Image is ${size} bytes; Pinterest allows at most ${PINTEREST_IMAGE_MAX_BYTES}.`,
        rule: "pinterest.image.size_max",
        platform: PLATFORM,
        remediation: `Re-encode under ${PINTEREST_IMAGE_MAX_BYTES} bytes (20 MB).`,
      });
    }
  }
}

async function fetchAndAssertOk(
  url: string,
  ctx: { rule: string; remediation: string },
): Promise<{ headers: Headers }> {
  let res;
  try {
    res = await platformFetch({
      method: "GET",
      url,
      // A handful of CDNs (including Pinterest's own image hosts) reject HEAD
      // or don't echo content-length on HEAD; we use GET and rely on the
      // outer client to short-circuit. A proper HEAD-with-fallback lands in
      // Phase 11.
      platform: PLATFORM,
      timeoutMs: 10_000,
    });
  } catch (err) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Failed to reach ${url}.`,
      rule: ctx.rule,
      platform: PLATFORM,
      remediation: ctx.remediation,
      platformResponse:
        err instanceof Error ? { message: err.message } : undefined,
    });
  }
  if (!res.ok) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `URL returned ${res.status}: ${url}`,
      rule: ctx.rule,
      platform: PLATFORM,
      remediation: ctx.remediation,
    });
  }
  return { headers: res.headers };
}
