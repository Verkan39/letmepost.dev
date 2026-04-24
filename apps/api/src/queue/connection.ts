import { Redis, type RedisOptions } from "ioredis";

/**
 * Shared Redis connection factory for BullMQ. We default to the port mapped by
 * `docker-compose.dev.yml` (6380 → 6379 inside the container) so `pnpm worker`
 * just works against the local dev stack. Override with `REDIS_URL` in
 * production / Upstash.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on any connection used by a
 * Worker or QueueEvents subscriber — otherwise long-lived blocking commands
 * (BRPOPLPUSH, XREAD …) throw after the default retry cap is hit. We therefore
 * disable that cap here globally; producers don't care.
 */

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6380";

export function readRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url || url.length === 0) return DEFAULT_REDIS_URL;
  return url;
}

export function createRedisConnection(
  overrides: Partial<RedisOptions> = {},
): Redis {
  const url = readRedisUrl();
  return new Redis(url, {
    maxRetriesPerRequest: null,
    // Don't let a missing Redis crash worker imports at test time; BullMQ itself
    // will surface the connection error when it actually tries to use it.
    lazyConnect: true,
    ...overrides,
  });
}
