import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signing for webhook delivery. We prefix the hex digest with
 * `sha256=` to match Stripe / GitHub's convention — consumers that support
 * either can verify us with zero adapter code.
 */

const PREFIX = "sha256=";

export function signHmac(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `${PREFIX}${digest}`;
}

/**
 * Constant-time comparison of a presented signature against the expected one.
 *
 * Accepts both `sha256=…` and bare-hex forms so consumers don't trip on the
 * prefix. Returns `false` (never throws) on length mismatch, malformed hex, or
 * wrong secret — the caller just treats all of those as "invalid".
 */
export function verifyHmac(
  secret: string,
  body: string,
  signature: string,
): boolean {
  if (typeof signature !== "string" || signature.length === 0) return false;

  const expected = signHmac(secret, body);
  const presented = signature.startsWith(PREFIX) ? signature : `${PREFIX}${signature}`;

  if (expected.length !== presented.length) return false;

  // Both are ASCII hex with the same prefix — safe to compare as byte buffers.
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
