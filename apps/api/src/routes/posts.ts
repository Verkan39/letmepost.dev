import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  CreatePostRequest,
  type CreatePostResponse,
  type WebhookEventType,
} from "@letmepost/schemas";
import { posts as postsTable } from "../db/schema/posts.js";
import { LetmepostError } from "../errors.js";
import { apiKeyAuth } from "../middleware/api-key.js";
import { idempotency } from "../middleware/idempotency.js";
import { assertKeyCanAccessProfile } from "../middleware/profile-scope.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { blueskyPublisher } from "../platforms/bluesky/publisher.js";
import { linkedinPublisher } from "../platforms/linkedin/publisher.js";
import { pinterestPublisher } from "../platforms/pinterest/publisher.js";
import { twitterPublisher } from "../platforms/twitter/publisher.js";
import type { DecryptedPlatformAccount } from "../repositories/platform-accounts.js";
import { DrizzlePlatformAccountsRepository } from "../repositories/platform-accounts.js";

export const posts = new Hono();

posts.use("*", apiKeyAuth());
posts.use("*", rateLimit());
posts.use("*", idempotency());

/**
 * Minimum future-delay before we accept a scheduled post, to avoid races
 * where the job fires before this transaction commits.
 */
const MIN_FUTURE_DELAY_MS = 1_000;

/**
 * Hybrid publish contract:
 *   - Immediate posts (no `scheduledAt`): synchronous publish, returns 201
 *     with the platform result. Matches the pre-Phase-4 contract.
 *   - Scheduled posts (`scheduledAt` set in the future): persisted with
 *     status="queued", delayed job enqueued on the `publish` queue, returns
 *     202 with the post id + echoed scheduledAt.
 *
 * Scheduled posts currently accept text only. Media and first-comment on
 * scheduled posts need persistent media storage (R2) and a dedicated
 * first-comment column — both land in a follow-up slice.
 */
posts.post(
  "/",
  zValidator("json", CreatePostRequest, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Request body failed validation.",
        rule: issue?.path.join(".") || "body",
        platformResponse: result.error.issues,
        remediation: "Check the request body matches the documented schema.",
      });
    }
  }),
  async (c) => {
    const {
      account: accountRef,
      text,
      media,
      firstComment,
      scheduledAt,
    } = c.req.valid("json");
    const { organizationId } = c.var.apiKey;
    const repo = new DrizzlePlatformAccountsRepository(c.var.db);

    const account = await repo.findById(accountRef.id);
    if (!account || account.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Platform account not found.",
        remediation:
          "Verify the account id and that it belongs to your organization.",
      });
    }

    // Enforce the api-key's profile scope. Cross-profile keys 404 here so we
    // don't leak the account's existence to a caller that shouldn't see it.
    assertKeyCanAccessProfile(c.var.apiKey, account);

    if (account.platform !== accountRef.platform) {
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Platform mismatch: account is ${account.platform} but request specified ${accountRef.platform}.`,
      });
    }

    // ─── Scheduled path ─────────────────────────────────────────────────────
    if (scheduledAt) {
      const when = new Date(scheduledAt);
      const delayMs = when.getTime() - Date.now();
      if (delayMs < MIN_FUTURE_DELAY_MS) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: "scheduledAt must be at least 1 second in the future.",
          rule: "scheduledAt.future",
          remediation:
            "Send a timestamp at least 1 second ahead of now, or omit scheduledAt to publish immediately.",
        });
      }
      if (media || firstComment) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message:
            "Scheduled posts do not yet support media or firstComment — publish immediately or wait for the scheduled-media slice.",
          rule: "scheduledAt.text_only",
          remediation:
            "Drop media/firstComment from this request, or omit scheduledAt to publish synchronously.",
        });
      }

      const [row] = await c.var.db
        .insert(postsTable)
        .values({
          organizationId,
          accountId: account.id,
          status: "queued",
          text,
          scheduledAt: when,
        })
        .returning();
      if (!row) {
        throw new LetmepostError({
          code: "internal_error",
          status: 500,
          message: "Failed to persist the scheduled post.",
        });
      }

      await c.var.publishEnqueuer.enqueue(
        {
          postId: row.id,
          organizationId,
          ...(c.var.requestId ? { requestId: c.var.requestId } : {}),
        },
        { delayMs },
      );

      await c.var.webhookDispatcher.dispatch({
        organizationId,
        type: "post.queued",
        data: {
          id: row.id,
          platform: account.platform,
          accountId: account.id,
          profileId: account.profileId,
          scheduledAt: when.toISOString(),
          queuedAt: row.createdAt.toISOString(),
        },
        ...(c.var.requestId ? { requestId: c.var.requestId } : {}),
      });

      const body: CreatePostResponse = {
        id: row.id,
        platform: account.platform,
        status: "queued",
        scheduledAt: when.toISOString(),
        createdAt: row.createdAt.toISOString(),
      };
      return c.json(body, 202);
    }

    // ─── Immediate path ─────────────────────────────────────────────────────
    const [row] = await c.var.db
      .insert(postsTable)
      .values({
        organizationId,
        accountId: account.id,
        status: "publishing",
        text,
        mediaRefs: media ? [...media] : [],
      })
      .returning();
    if (!row) {
      throw new LetmepostError({
        code: "internal_error",
        status: 500,
        message: "Failed to persist the post.",
      });
    }

    try {
      const result = await publishFor(account, {
        text,
        ...(media !== undefined ? { media } : {}),
        ...(firstComment !== undefined ? { firstComment } : {}),
      });

      const publishedAt = new Date();
      await c.var.db
        .update(postsTable)
        .set({
          status: "published",
          platformUri: result.uri ?? null,
          platformCid: result.cid ?? null,
          publishedAt,
        })
        .where(eq(postsTable.id, row.id));

      await c.var.webhookDispatcher.dispatch({
        organizationId,
        type: "post.published",
        data: {
          id: row.id,
          platform: account.platform,
          accountId: account.id,
          profileId: account.profileId,
          uri: result.uri,
          cid: result.cid,
          firstCommentUri: result.firstCommentUri,
          firstCommentCid: result.firstCommentCid,
          publishedAt: publishedAt.toISOString(),
          warnings: result.warnings,
        },
        ...(c.var.requestId ? { requestId: c.var.requestId } : {}),
      });

      const body: CreatePostResponse = {
        ...result,
        id: row.id,
        status: "published",
      };
      return c.json(body, 201);
    } catch (err) {
      const { status, eventType } = classifyError(err);
      await c.var.db
        .update(postsTable)
        .set({
          status,
          error: letmepostErrorToRecord(err),
        })
        .where(eq(postsTable.id, row.id));

      if (eventType) {
        await c.var.webhookDispatcher
          .dispatch({
            organizationId,
            type: eventType,
            data: {
              id: row.id,
              platform: account.platform,
              accountId: account.id,
              profileId: account.profileId,
              error: letmepostErrorToRecord(err),
              rejectedAt: new Date().toISOString(),
            },
            ...(c.var.requestId ? { requestId: c.var.requestId } : {}),
          })
          .catch((dispatchErr: unknown) => {
            // Don't swallow the publish error — just log the dispatch miss.
            console.error(
              "[posts] webhook dispatch failed after publish error",
              dispatchErr,
            );
          });
      }

      throw err;
    }
  },
);

function classifyError(err: unknown): {
  status: "rejected" | "failed";
  eventType: WebhookEventType | null;
} {
  if (!(err instanceof LetmepostError)) {
    return { status: "failed", eventType: "post.failed" };
  }
  switch (err.code) {
    case "preflight_failed":
    case "platform_auth_failed":
    case "platform_rejected":
      return { status: "rejected", eventType: "post.rejected" };
    case "platform_unavailable":
    case "internal_error":
      return { status: "failed", eventType: "post.failed" };
    default:
      // validation_failed / not_found / unauthenticated / etc. happen before
      // the posts row insert, so they shouldn't reach here — but if they do,
      // mark the row as failed without dispatching an event.
      return { status: "failed", eventType: null };
  }
}

function letmepostErrorToRecord(err: unknown): Record<string, unknown> {
  if (err instanceof LetmepostError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.rule ? { rule: err.rule } : {}),
      ...(err.platform ? { platform: err.platform } : {}),
      ...(err.platformVersion ? { platformVersion: err.platformVersion } : {}),
      ...(err.platformResponse !== undefined
        ? { platformResponse: err.platformResponse }
        : {}),
      ...(err.remediation ? { remediation: err.remediation } : {}),
    };
  }
  return {
    code: "internal_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Platform-dispatch. Each platform has its own `Publisher` implementation
 * with a platform-specific input shape — the switch here unpacks the generic
 * post body into the shape each publisher wants. Kept hand-rolled (not
 * registry-driven) because the per-platform input shapes are load-bearing
 * on types.
 *
 * Pinterest MVP: boardId/destinationUrl/imageUrl are pulled from the
 * account's tokenMetadata (populated at connect time or via a direct DB
 * write). The per-post pinterest shape is a Phase 11 follow-up.
 */
type PostPublishInput = {
  text: string;
  media?: Parameters<typeof blueskyPublisher.publish>[1]["media"];
  firstComment?: Parameters<typeof blueskyPublisher.publish>[1]["firstComment"];
};

async function publishFor(
  account: DecryptedPlatformAccount,
  input: PostPublishInput,
): Promise<CreatePostResponse> {
  switch (account.platform) {
    case "bluesky": {
      const blueskyInput: Parameters<typeof blueskyPublisher.publish>[1] = {
        text: input.text,
      };
      if (input.media !== undefined) blueskyInput.media = input.media;
      if (input.firstComment !== undefined) {
        blueskyInput.firstComment = input.firstComment;
      }
      return blueskyPublisher.publish(
        { handle: account.platformAccountId, appPassword: account.token },
        blueskyInput,
      );
    }
    case "linkedin": {
      const meta = (account.tokenMetadata ?? {}) as Record<string, unknown>;
      const authorUrn =
        typeof meta.authorUrn === "string" && meta.authorUrn.length > 0
          ? meta.authorUrn
          : `urn:li:person:${account.platformAccountId}`;
      return linkedinPublisher.publish(
        { accessToken: account.token, authorUrn },
        { text: input.text, authorUrn },
      );
    }
    case "twitter":
      return twitterPublisher.publish(
        {
          accessToken: account.token,
          userId: account.platformAccountId,
        },
        {
          text: input.text,
          ...(input.media !== undefined ? { media: input.media } : {}),
        },
      );
    case "pinterest": {
      const meta = (account.tokenMetadata ?? {}) as Record<string, unknown>;
      const boardId = pickString(meta.boardId) ?? pickString(meta.board_id);
      const destinationUrl =
        pickString(meta.destinationUrl) ?? pickString(meta.destination_url);
      const imageUrl =
        pickString(meta.imageUrl) ?? pickString(meta.image_url);
      if (!boardId || !destinationUrl || !imageUrl) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message:
            "Pinterest posts need boardId, destinationUrl, and imageUrl set on the account metadata (MVP).",
          rule: "pinterest.account_metadata.required",
          remediation:
            "Populate boardId/destinationUrl/imageUrl on platformAccount.tokenMetadata or wait for the Phase 11 per-post media slice.",
        });
      }
      return pinterestPublisher.publish(
        { accessToken: account.token },
        {
          boardId,
          destinationUrl,
          imageUrl,
          ...(input.text !== undefined ? { text: input.text } : {}),
        },
      );
    }
    default:
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Unknown platform: ${account.platform}.`,
      });
  }
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
