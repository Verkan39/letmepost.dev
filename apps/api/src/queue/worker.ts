import { Worker, UnrecoverableError } from "bullmq";
import { and, eq, isNull } from "drizzle-orm";
import { LetmepostError } from "../errors.js";
import { db } from "../db/instance.js";
import { posts as postsTable } from "../db/schema/posts.js";
import { webhookEndpoints } from "../db/schema/webhook_endpoints.js";
import { blueskyPublisher } from "../platforms/bluesky/publisher.js";
import { DrizzlePlatformAccountsRepository } from "../repositories/platform-accounts.js";
import { deliverWebhook } from "../webhooks/deliver.js";
import { createDefaultWebhookDispatcher } from "../webhooks/dispatch.js";
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
 * The `publish` worker processes scheduled posts: re-reads the posts row,
 * decrypts the platform token, publishes, updates the row, and dispatches
 * the appropriate lifecycle event. Immediate posts don't touch this worker
 * — the request handler publishes inline.
 */

const connection = createRedisConnection();
const dispatcher = createDefaultWebhookDispatcher(db);

const publishWorker = new Worker<PublishJobData>(
  QUEUE_NAMES.publish,
  async (job) => {
    const { postId, organizationId, requestId } = job.data;

    const [post] = await db
      .select()
      .from(postsTable)
      .where(eq(postsTable.id, postId))
      .limit(1);
    if (!post) {
      throw new UnrecoverableError(
        `publish worker: posts row ${postId} not found — likely deleted between enqueue and run`,
      );
    }
    if (post.status === "published") {
      // Idempotent replay — someone already finalised this post.
      return { skipped: true, reason: "already-published" };
    }

    await db
      .update(postsTable)
      .set({ status: "publishing" })
      .where(eq(postsTable.id, post.id));

    const repo = new DrizzlePlatformAccountsRepository(db);
    const account = await repo.findById(post.accountId);
    if (!account) {
      const err = new LetmepostError({
        code: "internal_error",
        status: 500,
        message: "Platform account no longer exists — scheduled post cannot run.",
      });
      await finaliseFailure(post.id, err, account, organizationId, requestId);
      throw new UnrecoverableError(err.message);
    }

    try {
      let result;
      switch (account.platform) {
        case "bluesky":
          result = await blueskyPublisher.publish(
            {
              handle: account.platformAccountId,
              appPassword: account.token,
            },
            { text: post.text },
          );
          break;
        default:
          throw new LetmepostError({
            code: "validation_failed",
            status: 400,
            message: `Unknown platform: ${account.platform}.`,
          });
      }

      const publishedAt = new Date();
      await db
        .update(postsTable)
        .set({
          status: "published",
          platformUri: result.uri ?? null,
          platformCid: result.cid ?? null,
          publishedAt,
        })
        .where(eq(postsTable.id, post.id));

      await dispatcher.dispatch({
        organizationId,
        type: "post.published",
        data: {
          id: post.id,
          platform: account.platform,
          accountId: account.id,
          uri: result.uri,
          cid: result.cid,
          publishedAt: publishedAt.toISOString(),
        },
        ...(requestId ? { requestId } : {}),
      });

      return { ok: true, uri: result.uri, cid: result.cid };
    } catch (err) {
      await finaliseFailure(post.id, err, account, organizationId, requestId);
      // 4xx-family errors → don't retry (preflight / platform_rejected /
      // platform_auth_failed). Transient errors bubble up so BullMQ retries.
      if (err instanceof LetmepostError) {
        const permanent =
          err.code === "preflight_failed" ||
          err.code === "platform_rejected" ||
          err.code === "platform_auth_failed" ||
          err.code === "validation_failed";
        if (permanent) {
          throw new UnrecoverableError(err.message);
        }
      }
      throw err;
    }
  },
  { connection },
);

async function finaliseFailure(
  postId: string,
  err: unknown,
  account: { id: string; platform: string } | null,
  organizationId: string,
  requestId: string | undefined,
): Promise<void> {
  const status =
    err instanceof LetmepostError &&
    (err.code === "preflight_failed" ||
      err.code === "platform_rejected" ||
      err.code === "platform_auth_failed")
      ? "rejected"
      : "failed";
  const eventType = status === "rejected" ? "post.rejected" : "post.failed";

  const errorRecord =
    err instanceof LetmepostError
      ? {
          code: err.code,
          message: err.message,
          ...(err.rule ? { rule: err.rule } : {}),
          ...(err.platform ? { platform: err.platform } : {}),
          ...(err.platformResponse !== undefined
            ? { platformResponse: err.platformResponse }
            : {}),
          ...(err.remediation ? { remediation: err.remediation } : {}),
        }
      : {
          code: "internal_error",
          message: err instanceof Error ? err.message : String(err),
        };

  await db
    .update(postsTable)
    .set({ status, error: errorRecord })
    .where(eq(postsTable.id, postId));

  if (!account) return;
  await dispatcher
    .dispatch({
      organizationId,
      type: eventType,
      data: {
        id: postId,
        platform: account.platform,
        accountId: account.id,
        error: errorRecord,
        rejectedAt: new Date().toISOString(),
      },
      ...(requestId ? { requestId } : {}),
    })
    .catch((e: unknown) => {
      console.error("[worker] failure-event dispatch failed", e);
    });
}

const validateWorker = new Worker<ValidateJobData>(
  QUEUE_NAMES.validate,
  async (_job) => {
    throw new Error(
      "validate worker not implemented — standalone validate endpoint lands in Phase 6",
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

    if (result.nonRetryable) {
      throw new UnrecoverableError(
        `webhook delivery rejected with ${result.status} (non-retryable)`,
      );
    }

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
