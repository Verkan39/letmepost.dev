import { randomBytes } from "node:crypto";

/**
 * Generate a UUIDv7 (RFC 9562 §5.7) — a 128-bit UUID whose leading 48 bits
 * are a millisecond Unix timestamp, making ids monotonically sortable by time.
 *
 * Layout:
 *   0-47   (6 bytes)   unix_ts_ms   — ms since epoch, big-endian
 *   48-51  (4 bits)    version      — 0111 (= 7)
 *   52-63  (12 bits)   rand_a       — random
 *   64-65  (2 bits)    variant      — 10
 *   66-127 (62 bits)   rand_b       — random
 */
export function uuidv7(): string {
  const ts = BigInt(Date.now());
  const bytes = randomBytes(16);

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
