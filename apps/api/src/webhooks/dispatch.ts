import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { WebhookEvent, WebhookEventType } from "@letmepost/schemas";
import type { DrizzleClient } from "../db/index.js";
import { webhookEndpoints } from "../db/schema/webhook_endpoints.js";
import {
  WEBHOOK_DELIVER_JOB_OPTIONS,
  getWebhookDeliverQueue,
} from "../queue/queues.js";

/**
 * Fan-out webhook events to every active subscription for the org, one
 * deliver job per matching endpoint. Pure dispatch — the delivery/retry
 * policy lives in `deliver.ts` and `queue/worker.ts`.
 *
 * Injected via createApp so tests can assert dispatch without running Redis.
 */
export interface WebhookDispatcher {
  dispatch(params: {
    organizationId: string;
    type: WebhookEventType;
    data: unknown;
    requestId?: string;
  }): Promise<void>;
}

function buildEvent(
  organizationId: string,
  type: WebhookEventType,
  data: unknown,
): WebhookEvent {
  return {
    id: randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    organizationId,
    data,
  };
}

export function createDefaultWebhookDispatcher(
  db: DrizzleClient,
): WebhookDispatcher {
  return {
    async dispatch({ organizationId, type, data, requestId }) {
      const endpoints = await db
        .select({
          id: webhookEndpoints.id,
          eventFilter: webhookEndpoints.eventFilter,
        })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.organizationId, organizationId),
            eq(webhookEndpoints.active, true),
            isNull(webhookEndpoints.disabledAt),
          ),
        );

      const matching = endpoints.filter(
        (e) => e.eventFilter.length === 0 || e.eventFilter.includes(type),
      );
      if (matching.length === 0) return;

      const event = buildEvent(organizationId, type, data);
      const queue = getWebhookDeliverQueue();
      await Promise.all(
        matching.map((e) =>
          queue.add(
            "deliver",
            {
              endpointId: e.id,
              organizationId,
              event,
              ...(requestId ? { requestId } : {}),
            },
            WEBHOOK_DELIVER_JOB_OPTIONS,
          ),
        ),
      );
    },
  };
}
