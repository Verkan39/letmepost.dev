import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  CreatePostRequest,
  Platform,
  PostStatus,
  type CreatePostResponse,
  type WebhookEventType,
} from "@letmepost/schemas";
import { posts as postsTable, type Post } from "../db/schema/posts.js";
import { LetmepostError } from "../errors.js";
import { apiKeyAuth } from "../middleware/api-key.js";
import { apiKeyOrSession } from "../middleware/api-key-or-session.js";
import { idempotency } from "../middleware/idempotency.js";
import { assertKeyCanAccessProfile } from "../middleware/profile-scope.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { publishForAccount } from "../platforms/_shared/dispatch.js";
import { DrizzlePlatformAccountsRepository } from "../repositories/platform-accounts.js";
import {
  DrizzlePostsReadRepository,
  type PostListFilters,
  type PostWithAccount,
} from "../repositories/posts.js";

export const posts = new Hono();

// Per-route middleware chains:
//   POST /v1/posts          → strict API key + rate limit + idempotency
//   GET  /v1/posts          → API key OR dashboard session (read-only)
//   GET  /v1/posts/:id      → same as list
//
// Reads accept session because the dashboard talks to the same endpoint;
// writes stay strict-key only because idempotency / audit / billing are
// keyed on the api_keys row.

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
  apiKeyAuth(),
  rateLimit(),
  idempotency(),
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
      pinterest,
      threads,
      twitter,
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
      const result = await publishForAccount(
        account,
        {
          text,
          ...(media !== undefined ? { media } : {}),
          ...(firstComment !== undefined ? { firstComment } : {}),
          ...(pinterest !== undefined ? { pinterest } : {}),
          ...(threads !== undefined ? { threads } : {}),
          ...(twitter !== undefined ? { twitter } : {}),
          mediaContext: {
            db: c.var.db,
            organizationId,
            profileId: account.profileId,
          },
        },
        { db: c.var.db },
      );

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

/* ─────────────────────────────────────────────────────────────────────────
 * Post Log — read endpoints
 * Both inherit the route's API-key auth + rate limit; idempotency only
 * matters on writes, so we don't double-charge reads against the replay
 * cache.
 * ───────────────────────────────────────────────────────────────────────── */

const ListPostsQuery = z.object({
  profileId: z.string().uuid().optional(),
  platform: z.array(Platform).optional(),
  status: z.array(PostStatus).optional(),
  errorCode: z.array(z.string().min(1)).optional(),
  after: z.string().datetime().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
});

function publicView(post: PostWithAccount) {
  return {
    id: post.id,
    profileId: post.account.profileId,
    accountId: post.accountId,
    account: {
      id: post.account.id,
      platform: post.account.platform,
      platformAccountId: post.account.platformAccountId,
      displayName: post.account.displayName,
    },
    platform: post.account.platform,
    status: post.status,
    text: post.text,
    mediaRefs: post.mediaRefs,
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    platformUri: post.platformUri,
    platformCid: post.platformCid,
    error: post.error,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

/**
 * Coerce repeated query params (`?platform=a&platform=b`) into an array.
 * Also accepts comma-separated single values (`?platform=a,b`) — both are
 * common conventions and integrators shouldn't have to remember which.
 */
function readArrayQuery(
  c: { req: { queries: (k: string) => string[] | undefined } },
  key: string,
): string[] | undefined {
  const values = c.req.queries(key);
  if (!values || values.length === 0) return undefined;
  const flat = values.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  return flat.length > 0 ? flat : undefined;
}

posts.get("/", apiKeyOrSession(), async (c) => {
  const rawQuery = {
    profileId: c.req.query("profileId"),
    platform: readArrayQuery(c, "platform"),
    status: readArrayQuery(c, "status"),
    errorCode: readArrayQuery(c, "errorCode"),
    after: c.req.query("after"),
    before: c.req.query("before"),
    limit: c.req.query("limit"),
    cursor: c.req.query("cursor"),
  };
  const parsed = ListPostsQuery.safeParse(rawQuery);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: issue?.message ?? "Invalid query parameters.",
      rule: issue?.path.join(".") || "query",
      platformResponse: parsed.error.issues,
    });
  }
  const q = parsed.data;
  const { organizationId, profileId: keyProfileId } = c.var.apiKey;

  // Profile-scope enforcement on list:
  //   - org-wide key (NULL) — caller's ?profileId is honored as-is
  //   - profile-scoped key — must match (or omit) ?profileId; otherwise 404
  let effectiveProfileId: string | null | undefined = keyProfileId ?? undefined;
  if (q.profileId !== undefined) {
    if (keyProfileId !== null && keyProfileId !== q.profileId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Profile not found.",
        rule: "api_key.profile_scope",
      });
    }
    effectiveProfileId = q.profileId;
  }

  const filters: PostListFilters = { organizationId };
  if (effectiveProfileId) filters.profileId = effectiveProfileId;
  if (q.platform) filters.platforms = q.platform;
  if (q.status) filters.statuses = q.status as Post["status"][];
  if (q.errorCode) filters.errorCodes = q.errorCode;
  if (q.after) filters.after = new Date(q.after);
  if (q.before) filters.before = new Date(q.before);

  const repo = new DrizzlePostsReadRepository(c.var.db);
  const result = await repo.list(filters, {
    limit: q.limit ?? 50,
    ...(q.cursor ? { cursor: q.cursor } : {}),
  });

  return c.json({
    data: result.data.map(publicView),
    nextCursor: result.nextCursor,
  });
});

posts.get("/:id", apiKeyOrSession(), async (c) => {
  const id = c.req.param("id");
  const { organizationId } = c.var.apiKey;
  const repo = new DrizzlePostsReadRepository(c.var.db);
  const post = await repo.findByIdWithAccount(id);
  if (!post || post.organizationId !== organizationId) {
    throw new LetmepostError({
      code: "not_found",
      status: 404,
      message: "Post not found.",
    });
  }
  // Profile scope: same 404-not-403 contract as POST /v1/posts.
  assertKeyCanAccessProfile(c.var.apiKey, post.account);

  const attempts = await repo.attemptsFor(id);

  return c.json({
    ...publicView(post),
    attempts: attempts.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      succeeded: a.succeeded,
      errorCode: a.errorCode,
      errorMessage: a.errorMessage,
      platformResponse: a.platformResponse,
    })),
  });
});

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

