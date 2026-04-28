import { randomBytes } from "node:crypto";

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * `med_` + 22 base62 chars. ~131 bits of entropy — unguessable in practice,
 * which is what carries the security story when objects are public-readable
 * (see plan.md Phase 7.5 "Future: signed URLs / CloudFront").
 *
 * 22 base62 chars = log2(62)·22 ≈ 131 bits, which exceeds a UUIDv4's 122 bits
 * of randomness. We use this in the URL key, not UUIDv7, because URLs land
 * in third-party logs (Pinterest CDN, Meta Graph audit trails) and a
 * monotonic prefix would let observers correlate uploads across orgs.
 */
export function generateMediaId(): string {
  const bytes = randomBytes(22);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out += BASE62_ALPHABET[bytes[i]! % 62];
  }
  return `med_${out}`;
}

const MEDIA_ID_PATTERN = /^med_[0-9A-Za-z]{22}$/;

export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && MEDIA_ID_PATTERN.test(value);
}
