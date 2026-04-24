import type { RefreshTokenJobData } from "./queues.js";
import { getRefreshTokenQueue } from "./queues.js";

/**
 * Thin wrapper around the `refresh-token` queue, matching the PublishEnqueuer
 * pattern so tests can stub enqueue calls without a running Redis.
 *
 * Refresh jobs are always delayed: `delayMs` is how far out the refresh
 * should run, computed by the caller from `tokenExpiresAt - now - horizon`.
 * The job id is derived from the account id so a replacement enqueue
 * (e.g. after an out-of-band refresh) deduplicates cleanly.
 */

export interface TokenRefreshEnqueuer {
  enqueue(data: RefreshTokenJobData, opts: { delayMs: number }): Promise<void>;
}

export const REFRESH_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 30_000 },
} as const;

function jobIdFor(accountId: string): string {
  // BullMQ forbids `:` in custom job IDs — it uses it as an internal key
  // separator. Use a dash-joined prefix instead.
  return `refresh-${accountId}`;
}

export function createDefaultTokenRefreshEnqueuer(): TokenRefreshEnqueuer {
  return {
    async enqueue(data, opts) {
      const delay = Math.max(0, opts.delayMs);
      await getRefreshTokenQueue().add("refresh-token", data, {
        ...REFRESH_JOB_OPTIONS,
        delay,
        jobId: jobIdFor(data.platformAccountId),
      });
    },
  };
}
