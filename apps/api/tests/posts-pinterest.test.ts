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

/**
 * Seeds a Pinterest account with `defaultBoardId` already populated — the
 * publisher's normal path. Per-post overrides on the request body are
 * exercised in their own test.
 */
async function seedWithPinterest(tx: DrizzleClient) {
  const fixture = await seed(tx);
  const repo = new DrizzlePlatformAccountsRepository(tx);
  const account = await repo.create({
    organizationId: fixture.organizationId,
    profileId: fixture.profileId,
    platform: "pinterest",
    platformAccountId: "pinterest-user-1",
    displayName: "alice-on-pinterest",
    token: "access-token-xyz",
    tokenMetadata: {
      defaultBoardId: "board-abc",
      defaultBoardName: "Default board",
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

const imageMedia = {
  kind: "image" as const,
  url: "https://example.com/img.jpg",
};

describeIfDb("POST /v1/posts (pinterest)", () => {
  it("publishes a pin via the request body's media + account default board", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      let pinBody: Record<string, unknown> | null = null;
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", async ({ request }) => {
          pinBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            id: "pin-123",
            board_id: "board-abc",
            link: "https://www.pinterest.com/pin/pin-123/",
          });
        }),
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
          media: [imageMedia],
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
      expect(pinBody).toMatchObject({
        board_id: "board-abc",
        link: "https://example.com/img.jpg",
        media_source: {
          source_type: "image_url",
          url: "https://example.com/img.jpg",
        },
        description: "our new product",
      });

      const [row] = await tx
        .select()
        .from(postsTable)
        .where(eq(postsTable.id, body.id));
      expect(row?.status).toBe("published");

      const ev = events.find((e) => e.type === "post.published");
      expect(ev).toBeDefined();
    });
  });

  it("honors per-post pinterest overrides (boardId + destinationUrl + title)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      let pinBody: Record<string, unknown> | null = null;
      server.use(
        ...imageReachable(),
        http.post("https://api.pinterest.com/v5/pins", async ({ request }) => {
          pinBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({
            id: "pin-456",
            board_id: "board-other",
            link: "https://example.com/product",
          });
        }),
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
          text: "with overrides",
          media: [imageMedia],
          pinterest: {
            boardId: "board-other",
            destinationUrl: "https://example.com/product",
            title: "Click here",
          },
        }),
      });

      expect(res.status).toBe(201);
      expect(pinBody).toMatchObject({
        board_id: "board-other",
        link: "https://example.com/product",
        title: "Click here",
        description: "with overrides",
      });
    });
  });

  it("rejects when no media is supplied (validation_failed)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "pinterest", id: account.id },
          text: "missing media",
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; rule?: string } };
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.rule).toBe("pinterest.media.required");
    });
  });

  it("rejects when neither defaultBoardId nor pinterest.boardId is set, and surfaces availableBoards", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const account = await repo.create({
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        platform: "pinterest",
        platformAccountId: "pinterest-user-2",
        displayName: "no-board",
        token: "access-token",
        tokenMetadata: {},
      });
      // The boardless-publish error path lists boards as a discoverability
      // hint. Stub a couple of boards and assert they show up on the error.
      server.use(
        http.get("https://api.pinterest.com/v5/boards", () =>
          HttpResponse.json({
            items: [
              { id: "board-a", name: "Inspiration" },
              { id: "board-b", name: "Travel" },
            ],
          }),
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
          text: "no board",
          media: [imageMedia],
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: {
          rule?: string;
          platformResponse?: {
            availableBoards?: { id: string; name: string }[];
          };
        };
      };
      expect(body.error.rule).toBe("pinterest.board.required");
      expect(body.error.platformResponse?.availableBoards).toEqual([
        { id: "board-a", name: "Inspiration" },
        { id: "board-b", name: "Travel" },
      ]);
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
          media: [imageMedia],
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

  it("fails in preflight (no Pinterest call) when the image URL returns 404", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { fixture, account } = await seedWithPinterest(tx);
      server.use(
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
          media: [imageMedia],
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
});
