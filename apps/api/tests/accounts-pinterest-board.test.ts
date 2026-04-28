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
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { DrizzlePlatformAccountsRepository } from "../src/repositories/platform-accounts.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";

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

const PINTEREST_BOARDS_URL = "https://api.pinterest.com/v5/boards";

function boardsHandler(items: { id: string; name: string }[]) {
  return http.get(PINTEREST_BOARDS_URL, () =>
    HttpResponse.json({ items }),
  );
}

describeIfDb("Pinterest default-board picker endpoints", () => {
  it("GET /v1/accounts/:id/pinterest/boards proxies /v5/boards + returns the current default", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const account = await repo.create({
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        platform: "pinterest",
        platformAccountId: "pin-user-1",
        token: "pin-access-token",
        tokenMetadata: {
          defaultBoardId: "board-a",
          defaultBoardName: "Default board",
        },
      });

      server.use(
        boardsHandler([
          { id: "board-a", name: "Default board" },
          { id: "board-b", name: "Another board" },
        ]),
      );

      const app = createApp({ db: tx });
      const res = await app.request(
        `/v1/accounts/${account.id}/pinterest/boards`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${fixture.apiKey.plaintext}` },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { id: string; name: string }[];
        defaultBoardId: string | null;
      };
      expect(body.defaultBoardId).toBe("board-a");
      expect(body.data.map((b) => b.id)).toEqual(["board-a", "board-b"]);
    });
  });

  it("PATCH /v1/accounts/:id/pinterest/default-board updates tokenMetadata", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const account = await repo.create({
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        platform: "pinterest",
        platformAccountId: "pin-user-2",
        token: "pin-access-token",
        tokenMetadata: {
          defaultBoardId: "board-a",
          defaultBoardName: "Default board",
        },
      });
      server.use(
        boardsHandler([
          { id: "board-a", name: "Default board" },
          { id: "board-b", name: "Another board" },
        ]),
      );

      const app = createApp({ db: tx });
      const res = await app.request(
        `/v1/accounts/${account.id}/pinterest/default-board`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fixture.apiKey.plaintext}`,
          },
          body: JSON.stringify({ boardId: "board-b" }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        defaultBoardId: string | null;
        defaultBoardName: string | null;
      };
      expect(body.defaultBoardId).toBe("board-b");
      expect(body.defaultBoardName).toBe("Another board");

      const reloaded = await repo.findById(account.id);
      expect(
        (reloaded?.tokenMetadata as Record<string, unknown> | undefined)
          ?.defaultBoardId,
      ).toBe("board-b");
    });
  });

  it("PATCH 404s when boardId doesn't belong to the account", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const repo = new DrizzlePlatformAccountsRepository(tx);
      const account = await repo.create({
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        platform: "pinterest",
        platformAccountId: "pin-user-3",
        token: "pin-access-token",
        tokenMetadata: {},
      });
      server.use(
        boardsHandler([{ id: "board-a", name: "Default board" }]),
      );

      const app = createApp({ db: tx });
      const res = await app.request(
        `/v1/accounts/${account.id}/pinterest/default-board`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${fixture.apiKey.plaintext}`,
          },
          body: JSON.stringify({ boardId: "board-not-yours" }),
        },
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("not_found");
      expect(body.error.rule).toBe("pinterest.board.unknown");
    });
  });

  it("rejects requests against a non-Pinterest account with platform.mismatch", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      // The seed fixture's default account is Bluesky.
      const fixture = await seed(tx);
      const app = createApp({ db: tx });
      const res = await app.request(
        `/v1/accounts/${fixture.accountId}/pinterest/boards`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${fixture.apiKey.plaintext}` },
        },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { rule?: string };
      };
      expect(body.error.rule).toBe("platform.mismatch");
    });
  });
});
