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

async function seedWithPinterest(tx: DrizzleClient) {
  const fixture = await seed(tx);
  const repo = new DrizzlePlatformAccountsRepository(tx);
  const account = await repo.create({
    organizationId: fixture.organizationId,
    profileId: fixture.profileId,
    platform: "pinterest",
    platformAccountId: "pinterest-user-1",
    displayName: "pinterest-user-1",
    token: "access-token-xyz",
    tokenMetadata: {
      boardId: "board-abc",
      destinationUrl: "https://example.com/product",
      imageUrl: "https://example.com/img.jpg",
    },
  });
  return { fixture, account };
}

function imageReachable() {
  return [
    http.get("https://example.com/product", () =>
      HttpResponse.json({ ok: true }, { status: 200 }),
    ),
    http.get(
      "https://example.com/img.jpg",
      () =>
        new HttpResponse(null, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        }),
    ),
  ];
}

describeIfDb("POST /v1/posts (pinterest)", () => {
  it("publishes a pin, marks the row published, dispatches post.published", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", () =>
          HttpResponse.json({
            id: "pin-123",
            board_id: "board-abc",
            link: "https://example.com/product",
          }),
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
          account: { platform: "pinterest", id: account.id },
          text: "our new product",
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        platform: string;
        status?: string;
      };
      expect(body.platform).toBe("pinterest");
      expect(body.status).toBe("published");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.id, body.id));
      expect(row?.status).toBe("published");

      const ev = events.find((e) => e.type === "post.published");
      expect(ev).toBeDefined();
      const data = ev?.data as { id: string; platform: string };
      expect(data.platform).toBe("pinterest");
    });
  });

  it("marks row rejected + emits post.rejected when Pinterest returns 401 (platform_auth_failed)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", () =>
          HttpResponse.json(
            { message: "Authentication failed", code: 2 },
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
          account: { platform: "pinterest", id: account.id },
          text: "auth should fail",
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

      const rejected = events.find((e) => e.type === "post.rejected");
      expect(rejected).toBeDefined();
    });
  });

  it("marks row rejected + emits post.rejected on a duplicate-pin error", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", () =>
          HttpResponse.json(
            { message: "Duplicate pin already exists", code: 150 },
            { status: 409 },
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
          account: { platform: "pinterest", id: account.id },
          text: "will duplicate",
        }),
      });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; remediation?: string } };
      expect(body.error.code).toBe("platform_rejected");
      expect(body.error.remediation).toContain("duplicate");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.organizationId, fixture.organizationId));
      expect(row?.status).toBe("rejected");
      expect(events.some((e) => e.type === "post.rejected")).toBe(true);
    });
  });

  it("fails in preflight (no Pinterest call) when the image URL returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
        http.get(
          "https://example.com/product",
          () => new HttpResponse(null, { status: 200 }),
        ),
        http.get(
          "https://example.com/img.jpg",
          () => new HttpResponse(null, { status: 404 }),
        ),
      );
      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "pinterest", id: account.id },
          text: "missing image",
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("pinterest.image_url.reachable");

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.organizationId, fixture.organizationId));
      expect(row?.status).toBe("rejected");
    });
  });

  it("marks row failed + emits post.failed when Pinterest is unreachable (network error)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", () => HttpResponse.error()),
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
          account: { platform: "pinterest", id: account.id },
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
