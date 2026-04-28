import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { seed } from "../src/db/seed.js";
import { media as mediaTable } from "../src/db/schema/media.js";
import { LetmepostError } from "../src/errors.js";
import { generateMediaId } from "../src/media/ids.js";
import { loadMediaItem } from "../src/platforms/_shared/media.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";

const server = setupServer();

const PUBLIC_BASE_URL = "https://letmepost-media.s3.us-east-1.amazonaws.com";

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
  process.env.MEDIA_PUBLIC_BASE_URL = PUBLIC_BASE_URL;
  process.env.MEDIA_ENV_PREFIX = "test";
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await closeTestDb();
});

const describeIfDb = canRunDbTests ? describe : describe.skip;

describeIfDb("loadMediaItem — mediaId variant", () => {
  it("resolves a mediaId to bytes from the public URL", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const mediaId = generateMediaId();
      const s3Key = `test/${fixture.organizationId}/${mediaId}.jpg`;
      await tx.insert(mediaTable).values({
        id: mediaId,
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        contentType: "image/jpeg",
        sizeBytes: 4,
        sha256: "0".repeat(64),
        s3Key,
      });

      server.use(
        http.get(`${PUBLIC_BASE_URL}/${s3Key}`, () =>
          HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4]).buffer, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
        ),
      );

      const loaded = await loadMediaItem(
        { kind: "image", mediaId, altText: "alt" },
        {
          db: tx,
          organizationId: fixture.organizationId,
          profileId: fixture.profileId,
        },
      );

      expect(loaded.kind).toBe("image");
      expect(loaded.mimeType).toBe("image/jpeg");
      expect(loaded.byteLength).toBe(4);
      expect(loaded.altText).toBe("alt");
    });
  });

  it("404s on cross-tenant mediaId access", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const orgA = await seed(tx, {
        orgSlug: `seed-a-${Math.random().toString(36).slice(2, 8)}`,
        userEmail: `a+${Math.random().toString(36).slice(2, 8)}@letmepost.test`,
        blueskyHandle: `a-${Math.random().toString(36).slice(2, 8)}.bsky.social`,
      });
      const orgB = await seed(tx, {
        orgSlug: `seed-b-${Math.random().toString(36).slice(2, 8)}`,
        userEmail: `b+${Math.random().toString(36).slice(2, 8)}@letmepost.test`,
        blueskyHandle: `b-${Math.random().toString(36).slice(2, 8)}.bsky.social`,
      });
      const mediaId = generateMediaId();
      const s3Key = `test/${orgA.organizationId}/${mediaId}.jpg`;
      await tx.insert(mediaTable).values({
        id: mediaId,
        organizationId: orgA.organizationId,
        profileId: orgA.profileId,
        contentType: "image/jpeg",
        sizeBytes: 4,
        sha256: "0".repeat(64),
        s3Key,
      });

      // No MSW handler — reaching S3 would mean the scope check failed.

      let caught: unknown;
      try {
        await loadMediaItem(
          { kind: "image", mediaId },
          {
            db: tx,
            organizationId: orgB.organizationId,
            profileId: orgB.profileId,
          },
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(LetmepostError);
      const lp = caught as LetmepostError;
      expect(lp.code).toBe("not_found");
      expect(lp.status).toBe(404);
      expect(lp.rule).toBe("media.unknown");
    });
  });

  it("404s on unknown mediaId", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      let caught: unknown;
      try {
        await loadMediaItem(
          { kind: "image", mediaId: "med_doesnotexist0000000000" },
          {
            db: tx,
            organizationId: fixture.organizationId,
            profileId: fixture.profileId,
          },
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(LetmepostError);
      expect((caught as LetmepostError).code).toBe("not_found");
    });
  });

  it("throws internal_error if mediaId is given without tenancy context", async () => {
    let caught: unknown;
    try {
      await loadMediaItem({
        kind: "image",
        mediaId: "med_abcdefghijklmnopqrstuv",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LetmepostError);
    expect((caught as LetmepostError).code).toBe("internal_error");
  });
});
