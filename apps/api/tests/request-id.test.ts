import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("request-id middleware", () => {
  it("generates an x-request-id when the caller doesn't send one", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id!.length).toBeGreaterThanOrEqual(16);
  });

  it("echoes the caller's x-request-id when supplied", async () => {
    const app = createApp();
    const incoming = "req_01HQZABCDEF0123456789ABCD";
    const res = await app.request("/health", {
      headers: { "X-Request-Id": incoming },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(incoming);
  });

  it("stamps requestId onto error response bodies", async () => {
    const app = createApp();
    const incoming = "req_error_body_probe";
    const res = await app.request("/v1/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": incoming,
      },
      body: JSON.stringify({
        account: { platform: "bluesky", id: "00000000-0000-0000-0000-000000000000" },
        text: "nope",
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBe(incoming);
    const body = (await res.json()) as {
      error: { code: string; requestId?: string };
    };
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.requestId).toBe(incoming);
  });
});
