import { Worker, UnrecoverableError } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/instance.js";
import { webhookEndpoints } from "../db/schema/webhook_endpoints.js";
import { deliverWebhook } from "../webhooks/deliver.js";
import { createRedisConnection } from "./connection.js";
import {
  QUEUE_NAMES,
  type PublishJobData,
  type RefreshTokenJobData,
  type ValidateJobData,
  type WebhookDeliverJobData,
  closeAllQueues,
} from "./queues.js";

/**
 * Worker entrypoint — `pnpm worker` starts this file. Boots one Worker per
 * queue against the shared Redis connection.
 *
 * The `publish`, `validate`, and `refresh-token` processors are stubs for this
 * slice; they'll be filled in when the publisher is wired onto the queue on
 * main. The `webhook-deliver` processor IS implemented — see below.
 */

const connection = createRedisConnection();

const publishWorker = new Worker<PublishJobData>(
  QUEUE_NAMES.publish,
  async (_job) => {
    throw new Error(
      "publish worker not implemented — integration step on main will wire this up",
    );
  },
  { connection },
);

const validateWorker = new Worker<ValidateJobData>(
  QUEUE_NAMES.validate,
  async (_job) => {
    throw new Error(
      "validate worker not implemented — integration step on main will wire this up",
    );
  },
  { connection },
);

const refreshTokenWorker = new Worker<RefreshTokenJobData>(
  QUEUE_NAMES.refreshToken,
  async (_job) => {
    throw new Error(
      "refresh-token worker not implemented — Phase 5 (OAuth) wires this up",
    );
  },
  { connection },
);

const webhookDeliverWorker = new Worker<WebhookDeliverJobData>(
  QUEUE_NAMES.webhookDeliver,
  async (job) => {
    const { endpointId, event, requestId } = job.data;

    const [endpoint] = await db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, endpointId),
          isNull(webhookEndpoints.disabledAt),
        ),
      )
      .limit(1);

    if (!endpoint) {
      // Endpoint deleted/disabled between enqueue and delivery — don't retry.
      throw new UnrecoverableError(
        `webhook endpoint ${endpointId} not found or disabled`,
      );
    }

    const deliverOptions: Parameters<typeof deliverWebhook>[2] = {};
    if (requestId) deliverOptions.requestId = requestId;
    const result = await deliverWebhook(
      {
        id: endpoint.id,
        url: endpoint.url,
        signingSecret: endpoint.signingSecret,
      },
      event,
      deliverOptions,
    );

    if (result.ok) return result;

    // 4xx → permanent. Use UnrecoverableError so BullMQ skips the remaining
    // attempts and parks the job in the failed set immediately.
    if (result.nonRetryable) {
      throw new UnrecoverableError(
        `webhook delivery rejected with ${result.status} (non-retryable)`,
      );
    }

    // 5xx / network → plain throw so BullMQ schedules the next exponential
    // backoff attempt. After `attempts` is exhausted the job lands in the
    // failed set — our DLQ.
    throw new Error(
      `webhook delivery failed with status ${result.status}${
        result.errorName ? ` (${result.errorName})` : ""
      }`,
    );
  },
  { connection },
);

const workers = [
  publishWorker,
  validateWorker,
  refreshTokenWorker,
  webhookDeliverWorker,
];

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  console.log(`[worker] received ${signal}, draining…`);
  await Promise.all(workers.map((w) => w.close()));
  await closeAllQueues();
  await connection.quit().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(
  `[worker] started — queues: ${Object.values(QUEUE_NAMES).join(", ")}`,
);
