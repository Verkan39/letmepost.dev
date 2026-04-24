import type { PublishJobData } from "./queues.js";
import { getPublishQueue } from "./queues.js";

/**
 * Thin wrapper around the `publish` queue so tests can inject a stub and
 * assert enqueues without a running Redis.
 */
export interface PublishEnqueuer {
  enqueue(data: PublishJobData, opts?: { delayMs?: number }): Promise<void>;
}

export const PUBLISH_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 10_000 },
} as const;

export function createDefaultPublishEnqueuer(): PublishEnqueuer {
  return {
    async enqueue(data, opts) {
      const delay = opts?.delayMs;
      await getPublishQueue().add("publish", data, {
        ...PUBLISH_JOB_OPTIONS,
        ...(delay && delay > 0 ? { delay } : {}),
      });
    },
  };
}
