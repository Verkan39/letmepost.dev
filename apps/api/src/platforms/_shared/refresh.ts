import type { DecryptedPlatformAccount } from "../../repositories/platform-accounts.js";
import { scopeKindFor } from "./scopes.js";

/**
 * Compute the delay (ms from now) until the refresh scheduler should wake
 * up for this account. `horizonMs` comes from the provider.
 *
 * - No `tokenExpiresAt` → `null` (no clock-driven refresh; rely on failure-
 *   driven re-auth). LinkedIn without an explicit exp would return null.
 * - Already within the horizon → wake up immediately (delay 0).
 * - Otherwise → wake up at (expiry - horizon).
 */
export function computeRefreshDelayMs(
  account: Pick<DecryptedPlatformAccount, "tokenExpiresAt">,
  horizonMs: number,
  now: Date = new Date(),
): number | null {
  if (!account.tokenExpiresAt) return null;
  const expMs = account.tokenExpiresAt.getTime();
  const delay = expMs - horizonMs - now.getTime();
  return delay <= 0 ? 0 : delay;
}

/**
 * Whether this platform should emit `token.expiring` lifecycle events at
 * horizon. Only OAuth platforms do — for credentials platforms (Bluesky),
 * refreshing is silent and human action is only needed when the credential
 * is revoked (surfaced as `token.revoked`).
 */
export function shouldEmitExpiringNotice(platform: string): boolean {
  return scopeKindFor(platform) === "oauth";
}
