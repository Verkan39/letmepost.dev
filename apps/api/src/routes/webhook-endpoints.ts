import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { WEBHOOK_EVENT_TYPES, type WebhookEvent } from "@letmepost/schemas";
import { webhookEndpoints } from "../db/schema/webhook_endpoints.js";
import { LetmepostError } from "../errors.js";
import { idempotency } from "../middleware/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireSession } from "../middleware/session.js";
import { deliverWebhook } from "../webhooks/deliver.js";

/**
 * `/v1/webhook-endpoints` — dashboard-scoped CRUD for outbound webhook
 * subscriptions. Mirrors the api-keys route in two load-bearing ways:
 *
 *   1. The signing secret is generated here, shown once in the create
 *      response, and never returned again. We store both the plaintext (used
 *      at delivery time) AND a sha256 of it (secret_hash) so operators can
 *      rotate with proof-of-knowledge if we ever need it.
 *   2. Delete is a hard delete (match api-keys' "revoke once, gone" model).
 *      The `active` flag exists so operators can pause delivery without
 *      losing the endpoint.
 *
 * Event-type filter: the public Zod enum in @letmepost/schemas is the
 * authority. We validate here so nobody ever persists a typo.
 */

const UrlSchema = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
    message: "webhook URL must use http:// or https://",
  });

const EventsSchema = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .default([])
  // De-dupe on the way in — nobody wants to explain why they got 3 copies.
  .transform((arr) => Array.from(new Set(arr)));

const CreateEndpointRequest = z.object({
  url: UrlSchema,
  events: EventsSchema,
  description: z.string().max(500).optional(),
});

const UpdateEndpointRequest = z
  .object({
    url: UrlSchema.optional(),
    events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).optional(),
    active: z.boolean().optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

const TestDeliveryRequest = z
  .object({
    type: z.enum(WEBHOOK_EVENT_TYPES).default("post.published"),
    data: z.unknown().optional(),
  })
  .default({ type: "post.published" });

/**
 * Sample payload used when the caller doesn't supply their own `data`. Shape
 * loosely mirrors what a real `post.published` event carries so consumer
 * handlers wired against it Just Work for testing.
 */
const SAMPLE_DATA: Record<string, unknown> = {
  postId: "00000000-0000-0000-0000-000000000000",
  platform: "bluesky",
  status: "published",
  text: "Test webhook from letmepost.dev — this is a synthetic event.",
  publishedAt: new Date().toISOString(),
  platformUri: "at://did:plc:test/app.bsky.feed.post/test",
};

function hashSecret(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateSigningSecret(): string {
  // 32 bytes of entropy, base64url — slightly longer than the api-key secret
  // because the webhook secret is the consumer's *only* line of defense and
  // has no prefix-of-known-origin to aid revocation lookups.
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function publicView(row: typeof webhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    url: row.url,
    events: row.eventFilter,
    description: row.description,
    active: row.active,
    lastDeliveryAt: row.lastDeliveryAt,
    lastFailureReason: row.lastFailureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type WebhookEndpointRoutesOptions = {
  /**
   * Override the default session middleware. Production never passes this.
   * Tests pass a no-op that relies on `createApp`'s `testSession` override to
   * have already set `c.var.session`.
   */
  sessionMiddleware?: MiddlewareHandler;
};

export function createWebhookEndpointRoutes(
  options: WebhookEndpointRoutesOptions = {},
) {
  const app = new Hono();
  app.use("*", options.sessionMiddleware ?? requireSession());
  app.use("*", rateLimit());
  app.use("*", idempotency());

  /** POST /v1/webhook-endpoints — create an endpoint. Secret shown once. */
  app.post(
    "/",
    zValidator("json", CreateEndpointRequest, (result) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: issue?.message ?? "Invalid request body.",
          rule: issue?.path.join(".") || "body",
          platformResponse: result.error.issues,
        });
      }
    }),
    async (c) => {
      const { url, events, description } = c.req.valid("json");
      const { organizationId } = c.var.session;

      const signingSecret = generateSigningSecret();
      const [row] = await c.var.db
        .insert(webhookEndpoints)
        .values({
          organizationId,
          url,
          signingSecret,
          secretHash: hashSecret(signingSecret),
          eventFilter: events,
          ...(description !== undefined ? { description } : {}),
        })
        .returning();
      if (!row) {
        throw new LetmepostError({
          code: "internal_error",
          status: 500,
          message: "Failed to create webhook endpoint.",
        });
      }

      return c.json(
        {
          ...publicView(row),
          // One-shot — this is the only time the caller will ever see it.
          signingSecret,
        },
        201,
      );
    },
  );

  /** GET /v1/webhook-endpoints — list for the session's active org. */
  app.get("/", async (c) => {
    const { organizationId } = c.var.session;
    const rows = await c.var.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.organizationId, organizationId))
      .orderBy(desc(webhookEndpoints.createdAt));
    return c.json({ data: rows.map(publicView) });
  });

  /** GET /v1/webhook-endpoints/:id — detail (no secret). */
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;
    const [row] = await c.var.db
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Webhook endpoint not found.",
      });
    }
    return c.json(publicView(row));
  });

  /** PATCH /v1/webhook-endpoints/:id — partial update. */
  app.patch(
    "/:id",
    zValidator("json", UpdateEndpointRequest, (result) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: issue?.message ?? "Invalid request body.",
          rule: issue?.path.join(".") || "body",
          platformResponse: result.error.issues,
        });
      }
    }),
    async (c) => {
      const id = c.req.param("id");
      const { organizationId } = c.var.session;
      const patch = c.req.valid("json");

      const update: Partial<typeof webhookEndpoints.$inferInsert> = {};
      if (patch.url !== undefined) update.url = patch.url;
      if (patch.events !== undefined) {
        update.eventFilter = Array.from(new Set(patch.events));
      }
      if (patch.active !== undefined) {
        update.active = patch.active;
        update.disabledAt = patch.active ? null : new Date();
      }
      if (patch.description !== undefined) {
        update.description = patch.description;
      }

      const [row] = await c.var.db
        .update(webhookEndpoints)
        .set(update)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.organizationId, organizationId),
          ),
        )
        .returning();

      if (!row) {
        throw new LetmepostError({
          code: "not_found",
          status: 404,
          message: "Webhook endpoint not found.",
        });
      }

      return c.json(publicView(row));
    },
  );

  /**
   * POST /v1/webhook-endpoints/:id/test — fire a synthetic event at the
   * endpoint's URL synchronously and return what the consumer responded.
   *
   * Bypasses BullMQ on purpose: operators want immediate feedback ("did my
   * handler 200?") not eventual delivery semantics. The real signing secret
   * is used so the consumer's HMAC verification path is the same one
   * production would hit. SAMPLE_DATA is the default payload; callers can
   * override with whatever JSON they want.
   */
  app.post(
    "/:id/test",
    zValidator("json", TestDeliveryRequest, (result) => {
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: issue?.message ?? "Invalid request body.",
          rule: issue?.path.join(".") || "body",
          platformResponse: result.error.issues,
        });
      }
    }),
    async (c) => {
      const id = c.req.param("id");
      const { organizationId } = c.var.session;
      const { type, data } = c.req.valid("json");

      const [row] = await c.var.db
        .select()
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.id, id),
            eq(webhookEndpoints.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new LetmepostError({
          code: "not_found",
          status: 404,
          message: "Webhook endpoint not found.",
        });
      }

      const event: WebhookEvent = {
        id: randomUUID(),
        type,
        createdAt: new Date().toISOString(),
        organizationId,
        data: data ?? SAMPLE_DATA,
      };

      const result = await deliverWebhook(
        {
          id: row.id,
          url: row.url,
          signingSecret: row.signingSecret,
        },
        event,
      );

      return c.json({
        delivered: result.ok,
        status: result.status,
        durationMs: result.durationMs,
        responseBody: result.responseBody ?? null,
        deliveryId: result.deliveryId,
        nonRetryable: result.nonRetryable ?? false,
        errorName: result.errorName ?? null,
        sentEvent: event,
      });
    },
  );

  /** DELETE /v1/webhook-endpoints/:id — hard delete, matches api-keys model. */
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;

    const [row] = await c.var.db
      .delete(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.id, id),
          eq(webhookEndpoints.organizationId, organizationId),
        ),
      )
      .returning();

    if (!row) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Webhook endpoint not found.",
      });
    }

    return c.json({ id: row.id, deleted: true });
  });

  return app;
}

/** Default export — uses real session auth. Mounted by `createApp`. */
export const webhookEndpointRoutes = createWebhookEndpointRoutes();
