import { PINTEREST_IMAGE_MAX_BYTES } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import { platformFetch } from "../_shared/http.js";

const PLATFORM = "pinterest";

const ALLOWED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface PinterestPublishInput {
  text?: string;
  boardId: string;
  destinationUrl: string;
  imageUrl: string;
  title?: string;
}

/**
 * Pure preflight — only validates fields callers control. URL reachability is
 * a separate async step because it requires a network call.
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
        "Provide a Pinterest board id — the pin must land on a board you own.",
    });
  }

  if (!input.destinationUrl || input.destinationUrl.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest pin requires a destinationUrl.",
      rule: "pinterest.destination_url.required",
      platform: PLATFORM,
      remediation:
        "Provide the click-through URL Pinterest opens when the pin is tapped.",
    });
  }

  if (!input.imageUrl || input.imageUrl.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Pinterest pin requires an imageUrl.",
      rule: "pinterest.image_url.required",
      platform: PLATFORM,
      remediation: "MVP supports single-image pins only; provide a public image URL.",
    });
  }

  assertHttpUrl(input.destinationUrl, "pinterest.destination_url.http");
  assertHttpUrl(input.imageUrl, "pinterest.image_url.http");
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
 * HEAD the destination and image URLs; confirm 2xx and, for the image, the
 * content-type + reported content-length against the Pinterest limits.
 *
 * Pinterest's docs put the single-image ceiling at 20 MB. We honour that as
 * the ceiling; servers that don't return a content-length are allowed
 * through (Pinterest will do its own check downstream).
 */
export async function assertPinterestUrlsReachable(input: {
  destinationUrl: string;
  imageUrl: string;
}): Promise<void> {
  // Destination URL — just needs to resolve.
  await headAndAssertOk(input.destinationUrl, {
    rule: "pinterest.destination_url.reachable",
    remediation:
      "Pinterest requires the destination URL to return 2xx on a HEAD request.",
  });

  // Image URL — also validate content-type and (when present) size.
  const imgRes = await headAndAssertOk(input.imageUrl, {
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

async function headAndAssertOk(
  url: string,
  ctx: { rule: string; remediation: string },
): Promise<{ headers: Headers }> {
  let res;
  try {
    res = await platformFetch({
      method: "GET",
      url,
      // A handful of CDNs (including Pinterest's own image hosts) reject HEAD
      // or don't echo content-length on HEAD — we use GET but rely on the
      // outer fetch to stream-abort; for MVP this is acceptable. A proper
      // HEAD with fallback lands in Phase 11 follow-up.
      platform: PLATFORM,
      timeoutMs: 10_000,
    });
  } catch (err) {
    // Already a LetmepostError(platform_unavailable) from platformFetch —
    // rewrap as preflight_failed because this is a user-supplied URL.
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
