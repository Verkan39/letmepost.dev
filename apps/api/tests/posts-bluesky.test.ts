import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createApp } from "../src/app.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CREATE_SESSION_URL = "https://bsky.social/xrpc/com.atproto.server.createSession";
const CREATE_RECORD_URL = "https://bsky.social/xrpc/com.atproto.repo.createRecord";

function validRequestBody(overrides: Partial<{ text: string; identifier: string; appPassword: string }> = {}) {
  return {
    account: {
      platform: "bluesky",
      identifier: overrides.identifier ?? "alice.bsky.social",
      appPassword: overrides.appPassword ?? "abcd-efgh-ijkl-mnop",
    },
    text: overrides.text ?? "Hello from letmepost.dev",
  };
}

async function post(body: unknown) {
  const app = createApp();
  return app.request("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /posts (bluesky)", () => {
  describe("happy path", () => {
    it("publishes a valid post and returns platform uri/cid", async () => {
      server.use(
        http.post(CREATE_SESSION_URL, () =>
          HttpResponse.json({
            accessJwt: "access-token",
            refreshJwt: "refresh-token",
            did: "did:plc:alice",
            handle: "alice.bsky.social",
          }),
        ),
        http.post(CREATE_RECORD_URL, () =>
          HttpResponse.json({
            uri: "at://did:plc:alice/app.bsky.feed.post/3kxyz",
            cid: "bafyrei123",
          }),
        ),
      );

      const res = await post(validRequestBody());
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.platform).toBe("bluesky");
      expect(body.uri).toBe("at://did:plc:alice/app.bsky.feed.post/3kxyz");
      expect(body.cid).toBe("bafyrei123");
      expect(body.id).toBe("bafyrei123");
      expect(typeof body.createdAt).toBe("string");
    });

    it("forwards the app password as the Bluesky password and sends the text in the record", async () => {
      let sessionRequestBody: unknown;
      let recordRequestBody: unknown;
      server.use(
        http.post(CREATE_SESSION_URL, async ({ request }) => {
          sessionRequestBody = await request.json();
          return HttpResponse.json({
            accessJwt: "access-token",
            refreshJwt: "refresh-token",
            did: "did:plc:alice",
            handle: "alice.bsky.social",
          });
        }),
        http.post(CREATE_RECORD_URL, async ({ request }) => {
          recordRequestBody = await request.json();
          return HttpResponse.json({ uri: "at://x/y/z", cid: "c" });
        }),
      );

      await post(
        validRequestBody({ text: "payload test", identifier: "alice.bsky.social", appPassword: "secret-password" }),
      );

      expect(sessionRequestBody).toEqual({
        identifier: "alice.bsky.social",
        password: "secret-password",
      });
      const recordBody = recordRequestBody as {
        repo: string;
        collection: string;
        record: { $type: string; text: string };
      };
      expect(recordBody.repo).toBe("did:plc:alice");
      expect(recordBody.collection).toBe("app.bsky.feed.post");
      expect(recordBody.record.$type).toBe("app.bsky.feed.post");
      expect(recordBody.record.text).toBe("payload test");
    });
  });

  describe("input validation (Zod layer)", () => {
    it("rejects a missing account with validation_failed", async () => {
      const res = await post({ text: "hello" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_failed");
    });

    it("rejects unknown platform with validation_failed", async () => {
      const res = await post({
        account: { platform: "mastodon", identifier: "x", appPassword: "y" },
        text: "hi",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_failed");
    });

    it("rejects an empty identifier", async () => {
      const res = await post(validRequestBody({ identifier: "" }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("validation_failed");
    });
  });

  describe("preflight (bluesky-specific rules)", () => {
    it("rejects text over 300 graphemes with preflight_failed and the specific rule", async () => {
      const res = await post(validRequestBody({ text: "a".repeat(301) }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule: string; platform: string; remediation: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.text.max_graphemes");
      expect(body.error.platform).toBe("bluesky");
      expect(body.error.remediation).toContain("300");
    });

    it("rejects whitespace-only text without calling Bluesky", async () => {
      // No MSW handlers registered — if the API called Bluesky, MSW would throw.
      const res = await post(validRequestBody({ text: "   " }));
      // Accepted by Zod's min(1) since whitespace is length>=1 — so preflight is what catches it.
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; rule?: string } };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.text.non_empty");
    });
  });

  describe("upstream platform failures", () => {
    it("returns platform_auth_failed when Bluesky 401s on createSession", async () => {
      server.use(
        http.post(CREATE_SESSION_URL, () =>
          HttpResponse.json(
            { error: "AuthenticationRequired", message: "Invalid identifier or password" },
            { status: 401 },
          ),
        ),
      );

      const res = await post(validRequestBody());
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        error: { code: string; platform: string; platformResponse: unknown; remediation: string };
      };
      expect(body.error.code).toBe("platform_auth_failed");
      expect(body.error.platform).toBe("bluesky");
      expect(body.error.platformResponse).toEqual({
        error: "AuthenticationRequired",
        message: "Invalid identifier or password",
      });
      expect(body.error.remediation).toContain("app password");
    });

    it("returns platform_rejected when Bluesky 400s on createRecord", async () => {
      server.use(
        http.post(CREATE_SESSION_URL, () =>
          HttpResponse.json({
            accessJwt: "a",
            refreshJwt: "r",
            did: "did:plc:alice",
            handle: "alice.bsky.social",
          }),
        ),
        http.post(CREATE_RECORD_URL, () =>
          HttpResponse.json(
            { error: "InvalidRequest", message: "Record validation failed" },
            { status: 400 },
          ),
        ),
      );

      const res = await post(validRequestBody());
      expect(res.status).toBe(502);
      const body = (await res.json()) as {
        error: { code: string; platform: string; platformResponse: unknown; message: string };
      };
      expect(body.error.code).toBe("platform_rejected");
      expect(body.error.platform).toBe("bluesky");
      expect(body.error.message).toContain("Record validation failed");
      expect(body.error.platformResponse).toEqual({
        error: "InvalidRequest",
        message: "Record validation failed",
      });
    });

    it("returns platform_rejected with raw body when Bluesky returns non-JSON", async () => {
      server.use(
        http.post(CREATE_SESSION_URL, () =>
          HttpResponse.json({
            accessJwt: "a",
            refreshJwt: "r",
            did: "did:plc:alice",
            handle: "alice.bsky.social",
          }),
        ),
        http.post(CREATE_RECORD_URL, () =>
          new HttpResponse("<html>502 Bad Gateway</html>", { status: 502 }),
        ),
      );

      const res = await post(validRequestBody());
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("platform_rejected");
      // Even without a JSON upstream body, we return a non-empty, meaningful message.
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  });
});
