import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { WebhookEvent } from "@letmepost/schemas";
import {
  DELIVERY_ID_HEADER,
  EVENT_HEADER,
  EVENT_ID_HEADER,
  REQUEST_ID_HEADER,
  SIGNATURE_HEADER,
  deliverWebhook,
} from "../src/webhooks/deliver.js";
import { signHmac, verifyHmac } from "../src/webhooks/sign.js";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const endpoint = {
  id: "whe_test_1",
  url: "https://consumer.example/webhook",
  signingSecret: "whsec_deadbeef",
};

const event: WebhookEvent = {
  id: "evt_123",
  type: "post.published",
  createdAt: "2026-04-24T12:00:00.000Z",
  organizationId: "org_1",
  data: { postId: "post_1" },
};

describe("deliverWebhook", () => {
  it("signs the body, attaches the canonical headers, and returns ok on 200", async () => {
    let seenBody = "";
    const seenHeaders: Record<string, string> = {};
    server.use(
      http.post(endpoint.url, async ({ request }) => {
        seenBody = await request.text();
        for (const [k, v] of request.headers.entries()) {
          seenHeaders[k.toLowerCase()] = v;
        }
        return HttpResponse.text("thanks", { status: 200 });
      }),
    );

    const result = await deliverWebhook(endpoint, event, {
      requestId: "req_abc",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.nonRetryable).toBeUndefined();
    expect(result.responseBody).toBe("thanks");
    expect(typeof result.deliveryId).toBe("string");

    // Body is JSON-encoded canonical event.
    expect(JSON.parse(seenBody)).toEqual(event);

    // Signature header is present, correctly formatted, and verifies.
    const sig = seenHeaders[SIGNATURE_HEADER.toLowerCase()];
    expect(sig).toBeDefined();
    expect(sig?.startsWith("sha256=")).toBe(true);
    expect(verifyHmac(endpoint.signingSecret, seenBody, sig!)).toBe(true);
    // And it matches what we'd compute directly.
    expect(sig).toBe(signHmac(endpoint.signingSecret, seenBody));

    expect(seenHeaders[EVENT_HEADER.toLowerCase()]).toBe("post.published");
    expect(seenHeaders[EVENT_ID_HEADER.toLowerCase()]).toBe("evt_123");
    expect(seenHeaders[DELIVERY_ID_HEADER.toLowerCase()]).toBe(result.deliveryId);
    expect(seenHeaders[REQUEST_ID_HEADER.toLowerCase()]).toBe("req_abc");
  });

  it("returns ok:false without nonRetryable on 5xx (the consumer outage path)", async () => {
    server.use(
      http.post(endpoint.url, () =>
        HttpResponse.text("upstream is down", { status: 503 }),
      ),
    );
    const result = await deliverWebhook(endpoint, event);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.nonRetryable).toBeUndefined();
    expect(result.responseBody).toBe("upstream is down");
  });

  it("returns ok:false with nonRetryable:true on 4xx (the consumer-config path)", async () => {
    server.use(
      http.post(endpoint.url, () =>
        HttpResponse.text("bad signature config", { status: 400 }),
      ),
    );
    const result = await deliverWebhook(endpoint, event);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.nonRetryable).toBe(true);
  });

  it("marks 401/403/404/422 as non-retryable too (any 4xx)", async () => {
    for (const status of [401, 403, 404, 422]) {
      server.use(
        http.post(endpoint.url, () => HttpResponse.text("nope", { status })),
      );
      const result = await deliverWebhook(endpoint, event);
      expect(result.status).toBe(status);
      expect(result.ok).toBe(false);
      expect(result.nonRetryable).toBe(true);
      server.resetHandlers();
    }
  });

  it("returns status:0 retryable result on network error", async () => {
    // Point at an unroutable host. MSW isn't configured to intercept this URL,
    // so fetch itself rejects — exactly the "network down" path we want to
    // exercise. `onUnhandledRequest: "error"` would normally complain; we
    // bypass it by calling deliverWebhook with a fetch that refuses the
    // request, which is behaviorally identical to a socket failure.
    const failingFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await deliverWebhook(endpoint, event, {
      fetch: failingFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.nonRetryable).toBeUndefined();
    expect(result.errorName).toBeDefined();
  });

  it("truncates large response bodies", async () => {
    const big = "x".repeat(5000);
    server.use(
      http.post(endpoint.url, () => HttpResponse.text(big, { status: 200 })),
    );
    const result = await deliverWebhook(endpoint, event);
    expect(result.ok).toBe(true);
    expect(result.responseBody?.length).toBeLessThanOrEqual(2048 + 20);
    expect(result.responseBody?.endsWith("[truncated]")).toBe(true);
  });
});
