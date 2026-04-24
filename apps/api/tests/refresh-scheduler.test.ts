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
import { member, organization, user } from "../src/db/schema/auth.js";
import { computeRefreshDelayMs } from "../src/platforms/_shared/refresh.js";
import type { TokenRefreshEnqueuer } from "../src/queue/refresh-enqueue.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";

describe("computeRefreshDelayMs", () => {
  it("returns null when tokenExpiresAt is missing (no clock-driven refresh)", () => {
    expect(
      computeRefreshDelayMs({ tokenExpiresAt: null }, 60_000),
    ).toBeNull();
  });

  it("returns 0 when expiry is already inside the horizon", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    const expiresIn1Min = new Date(now.getTime() + 60_000);
    expect(
      computeRefreshDelayMs({ tokenExpiresAt: expiresIn1Min }, 30 * 60_000, now),
    ).toBe(0);
  });

  it("returns (expiry - horizon - now) when expiry is beyond horizon", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    const expiresIn2h = new Date(now.getTime() + 2 * 60 * 60_000);
    const horizon = 30 * 60_000; // 30 min
    const delay = computeRefreshDelayMs(
      { tokenExpiresAt: expiresIn2h },
      horizon,
      now,
    );
    expect(delay).toBe(2 * 60 * 60_000 - horizon);
  });

  it("clamps to 0 when expiry is in the past (expired-but-still-present)", () => {
    const now = new Date("2026-04-25T12:00:00Z");
    const expired = new Date(now.getTime() - 1_000);
    expect(
      computeRefreshDelayMs({ tokenExpiresAt: expired }, 30 * 60_000, now),
    ).toBe(0);
  });
});

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

function buildMockAccessJwt(expSecondsFromNow = 2 * 60 * 60): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.sig`;
}

async function seedOrg(tx: Awaited<ReturnType<typeof getTestDb>>["db"]) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [u] = await tx
    .insert(user)
    .values({
      email: `ref+${suffix}@letmepost.test`,
      name: `Ref User ${suffix}`,
      emailVerified: true,
    })
    .returning();
  const [org] = await tx
    .insert(organization)
    .values({ name: `ref-org-${suffix}`, slug: `ref-${suffix}` })
    .returning();
  await tx
    .insert(member)
    .values({ organizationId: org!.id, userId: u!.id, role: "owner" });
  return { userId: u!.id, organizationId: org!.id };
}

describeIfDb("accounts: initial refresh scheduling on connect", () => {
  it("enqueues a delayed refresh job using the provider's expiringHorizonMs", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const { userId, organizationId } = await seedOrg(tx);

      // Mock Bluesky createSession with an access JWT expiring ~2h out. The
      // provider's horizon is 30min, so the scheduler should compute a delay
      // of roughly 90min.
      server.use(
        http.post(
          "https://bsky.social/xrpc/com.atproto.server.createSession",
          () =>
            HttpResponse.json({
              accessJwt: buildMockAccessJwt(2 * 60 * 60),
              refreshJwt: "refresh-token",
              did: "did:plc:alice",
              handle: "alice.bsky.social",
            }),
        ),
      );

      const captured: Array<{
        data: { platformAccountId: string; organizationId: string };
        delayMs: number;
      }> = [];
      const stub: TokenRefreshEnqueuer = {
        async enqueue(data, opts) {
          captured.push({ data, delayMs: opts.delayMs });
        },
      };

      const app = createApp({
        db: tx,
        testSession: { userId, organizationId },
        refreshEnqueuer: stub,
      });

      const res = await app.request("/v1/accounts/connect/bluesky/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: "alice.bsky.social",
          appPassword: "abcd-efgh-ijkl-mnop",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };

      expect(captured).toHaveLength(1);
      expect(captured[0]!.data.platformAccountId).toBe(body.id);
      expect(captured[0]!.data.organizationId).toBe(organizationId);
      // Horizon is 30 min; token lives 2h → delay should be between 80 and
      // 100 min to absorb clock jitter in the test harness.
      const minutes = captured[0]!.delayMs / 60_000;
      expect(minutes).toBeGreaterThan(80);
      expect(minutes).toBeLessThan(100);
    });
  });
});
