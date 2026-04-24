import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { eq } from "drizzle-orm";
import type { WebhookEventType } from "@letmepost/schemas";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { posts as postsTable } from "../src/db/schema/posts.js";
import { DrizzlePlatformAccountsRepository } from "../src/repositories/platform-accounts.js";
import type { WebhookDispatcher } from "../src/webhooks/dispatch.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";
import type { DrizzleClient } from "../src/db/index.js";

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(async () => {
  server.close();
  await closeTestDb();
});

const describeIfDb = canRunDbTests ? describe : describe.skip;

type CapturedEvent = {
  organizationId: string;
  type: WebhookEventType;
  data: unknown;
  requestId?: string;
};

function captureDispatcher(): {
  dispatcher: WebhookDispatcher;
  events: CapturedEvent[];
} {
  const events: CapturedEvent[] = [];
  return {
    events,
    dispatcher: {
      async dispatch(ev) {
        events.push(ev);
      },
    },
  };
}

async function seedWithTwitter(tx: DrizzleClient) {
  const fixture = await seed(tx);
  const repo = new DrizzlePlatformAccountsRepository(tx);
  const account = await repo.create({
    organizationId: fixture.organizationId,
    platform: "twitter",
    platformAccountId: "twitter-user-1",
    displayName: "twitter-user-1",
    token: "access-token-xyz",
    tokenMetadata: { username: "alice" },
  });
  return { fixture, account };
}

describeIfDb("POST /v1/posts (twitter)", () => {
  it("publishes a text tweet, marks row published, dispatches post.published", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithTwitter(tx);
      server.use(
        http.post("https://api.twitter.com/2/tweets", () =>
          HttpResponse.json({ data: { id: "1700000001", text: "hello" } }),
        ),
      );
      const { dispatcher, events } = captureDispatcher();
      const app = createApp({ db: tx, webhookDispatcher: dispatcher });

      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "twitter", id: account.id },
          text: "hello",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        platform: string;
        status?: string;
        uri?: string;
      };
      expect(body.platform).toBe("twitter");
      expect(body.status).toBe("published");
      expect(body.uri).toContain("twitter.com");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.id, body.id));
      expect(row?.status).toBe("published");
      expect(events.some((e) => e.type === "post.published")).toBe(true);
    });
  });

  it("marks row rejected + emits post.rejected on X auth failure (401)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithTwitter(tx);
      server.use(
        http.post("https://api.twitter.com/2/tweets", () =>
          HttpResponse.json(
            { title: "Unauthorized", status: 401, detail: "bad token" },
            { status: 401 },
          ),
        ),
      );
      const { dispatcher, events } = captureDispatcher();
      const app = createApp({ db: tx, webhookDispatcher: dispatcher });

      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "twitter", id: account.id },
          text: "unauthorized path",
        }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("platform_auth_failed");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.organizationId, fixture.organizationId));
      expect(row?.status).toBe("rejected");
      expect(events.some((e) => e.type === "post.rejected")).toBe(true);
    });
  });

  it("marks row rejected + emits post.rejected on a duplicate-tweet error (code 187)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithTwitter(tx);
      server.use(
        http.post("https://api.twitter.com/2/tweets", () =>
          HttpResponse.json(
            {
              errors: [
                { code: 187, message: "Status is a duplicate." },
              ],
            },
            { status: 403 },
          ),
        ),
      );
      const { dispatcher, events } = captureDispatcher();
      const app = createApp({ db: tx, webhookDispatcher: dispatcher });

      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "twitter", id: account.id },
          text: "a duplicate tweet",
        }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; remediation?: string } };
      expect(body.error.code).toBe("platform_rejected");
      expect(body.error.remediation).toContain("duplicate");

      expect(events.some((e) => e.type === "post.rejected")).toBe(true);
    });
  });

  it("fails preflight (no upstream call) for a tweet over 280 graphemes", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithTwitter(tx);
      // No MSW handlers — any upstream call would fail the test.
      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "twitter", id: account.id },
          text: "a".repeat(281),
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("twitter.text.max_graphemes");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.organizationId, fixture.organizationId));
      expect(row?.status).toBe("rejected");
    });
  });

  it("marks row failed + emits post.failed when X is unreachable (network error)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithTwitter(tx);
      server.use(
        http.post("https://api.twitter.com/2/tweets", () =>
          HttpResponse.error(),
        ),
      );
      const { dispatcher, events } = captureDispatcher();
      const app = createApp({ db: tx, webhookDispatcher: dispatcher });

      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "twitter", id: account.id },
          text: "network dies",
        }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("platform_unavailable");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.organizationId, fixture.organizationId));
      expect(row?.status).toBe("failed");
      expect(events.some((e) => e.type === "post.failed")).toBe(true);
    });
  });
});
