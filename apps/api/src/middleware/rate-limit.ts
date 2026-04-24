import type { Context, MiddlewareHandler } from "hono";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import { LetmepostError } from "../errors.js";

/**
 * Single-tier sliding-window limiter keyed by api_key id (preferred), session
 * user id, or client IP. One module-scoped limiter so separate route groups
 * share one bucket per caller.
 *
 * Backed by in-memory counters — fine for a single Node process. Phase 4
 * brings Redis for BullMQ; swap to `RateLimiterRedis` behind this same factory
 * without touching callers. Per-IP floor and per-platform connect-attempt
 * floors are deferred until Phase 5 introduces the connect endpoint.
 */

export type RateLimitConfig = {
  points: number;
  durationSec: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function defaultRateLimitConfig(): RateLimitConfig {
  return {
    points: numberFromEnv("RATE_LIMIT_POINTS", 120),
    durationSec: numberFromEnv("RATE_LIMIT_DURATION_SEC", 60),
  };
}

function identityFor(c: Context): string {
  const apiKeyId = (c.get("apiKey") as { apiKeyId?: string } | undefined)?.apiKeyId;
  if (apiKeyId) return `key:${apiKeyId}`;
  const userId = (c.get("session") as { userId?: string } | undefined)?.userId;
  if (userId) return `user:${userId}`;
  const forwarded = c.req.header("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0]!.trim()
    : c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

function setStandardHeaders(
  c: Context,
  limit: number,
  remaining: number,
  msBeforeNext: number,
): void {
  c.header("RateLimit-Limit", String(limit));
  c.header("RateLimit-Remaining", String(Math.max(remaining, 0)));
  c.header("RateLimit-Reset", String(Math.ceil(msBeforeNext / 1000)));
}

let limiter: RateLimiterMemory | null = null;
let activeConfig: RateLimitConfig | null = null;

function getLimiter(cfg: RateLimitConfig): RateLimiterMemory {
  if (
    !limiter ||
    !activeConfig ||
    activeConfig.points !== cfg.points ||
    activeConfig.durationSec !== cfg.durationSec
  ) {
    limiter = new RateLimiterMemory({
      points: cfg.points,
      duration: cfg.durationSec,
      keyPrefix: "rl",
    });
    activeConfig = cfg;
  }
  return limiter;
}

/**
 * Test-only: forces the next `rateLimit()` call to rebuild the limiter from a
 * fresh config. Keeps test cases from leaking quota state into each other.
 */
export function __resetRateLimitForTests(): void {
  limiter = null;
  activeConfig = null;
}

export function rateLimit(configOverride?: RateLimitConfig): MiddlewareHandler {
  return async (c, next) => {
    const cfg = configOverride ?? defaultRateLimitConfig();
    const instance = getLimiter(cfg);
    const id = identityFor(c);
    try {
      const result = await instance.consume(id, 1);
      setStandardHeaders(c, cfg.points, result.remainingPoints, result.msBeforeNext);
    } catch (err) {
      if (err instanceof Error) throw err;
      const rejected = err as RateLimiterRes;
      setStandardHeaders(
        c,
        cfg.points,
        Math.max(rejected.remainingPoints, 0),
        rejected.msBeforeNext,
      );
      c.header("Retry-After", String(Math.ceil(rejected.msBeforeNext / 1000)));
      throw new LetmepostError({
        code: "rate_limited",
        status: 429,
        message: "Rate limit exceeded.",
        remediation: "Back off until the RateLimit-Reset window elapses, then retry.",
      });
    }
    await next();
  };
}
