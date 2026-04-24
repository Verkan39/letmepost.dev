import { randomUUID } from "node:crypto";
import {
  WebhookEvent,
  WebhookEventType,
  WEBHOOK_EVENT_TYPES,
} from "@letmepost/schemas";

/**
 * Re-exports + a tiny factory to normalize how events are created inside the
 * API. The canonical schema lives in `@letmepost/schemas` so SDKs share it.
 */

// The Zod enum `WebhookEventType` is a runtime value AND a type; re-export
// both facets in the shape verbatimModuleSyntax wants.
export { WebhookEvent, WebhookEventType, WEBHOOK_EVENT_TYPES };

export function createEvent(input: {
  type: WebhookEventType;
  organizationId: string;
  data: unknown;
  id?: string;
  createdAt?: Date;
}): WebhookEvent {
  const envelope = {
    id: input.id ?? randomUUID(),
    type: input.type,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    organizationId: input.organizationId,
    data: input.data,
  };
  // Validate at the boundary so producers can't smuggle in malformed events.
  return WebhookEvent.parse(envelope);
}
