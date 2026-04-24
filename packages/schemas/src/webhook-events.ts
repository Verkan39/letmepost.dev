import { z } from "zod";

/**
 * Canonical catalog of webhook event types emitted by letmepost.dev. Keep this
 * list small and stable — every entry is a public contract with integrators.
 * Adding an event is cheap; removing one is a breaking change.
 */
export const WEBHOOK_EVENT_TYPES = [
  "post.queued",
  "post.validated",
  "post.published",
  "post.rejected",
  "post.failed",
  "token.expiring",
  "token.revoked",
  "version.deprecated",
] as const;

export const WebhookEventType = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/**
 * Wire envelope for every outbound webhook. The body posted to the consumer
 * endpoint is a JSON-encoded `WebhookEvent`; `data` is opaque and varies by
 * `type`. We keep the envelope stable so consumers can write one verifier.
 */
export const WebhookEvent = z.object({
  id: z.string(),
  type: WebhookEventType,
  createdAt: z.string(),
  organizationId: z.string(),
  data: z.unknown(),
});
export type WebhookEvent = z.infer<typeof WebhookEvent>;
