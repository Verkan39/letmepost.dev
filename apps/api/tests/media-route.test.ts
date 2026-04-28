import {
  afterAll,
  describe,
  expect,
  it,
} from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { seed } from "../src/db/seed.js";
import { media as mediaTable } from "../src/db/schema/media.js";
import { __resetS3CacheForTests } from "../src/media/s3.js";
import {
  canRunDbTests,
  closeTestDb,
  getTestDb,
  runInTransaction,
} from "./db/support.js";

afterAll(async () => {
  await closeTestDb();
});

/**
 * These tests require BOTH the integration DB and live S3 credentials.
 * They live in the same suite as the rest of the integration tests so
 * they fail loudly if the bucket policy / IAM user / env vars regress.
 *
 * Locally, set:
 *   - TEST_DATABASE_URL
 *   - AWS_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   - MEDIA_PUBLIC_BASE_URL  (e.g. https://letmepost-media.s3.us-east-1.amazonaws.com)
 *   - MEDIA_ENV_PREFIX       (e.g. `test`)
 *
 * Without S3 vars the suite skips (rather than failing) so the rest of the
 * fast loop still runs offline.
 */
const hasS3Creds =
  !!process.env.AWS_REGION &&
  !!process.env.S3_BUCKET &&
  !!process.env.S3_ACCESS_KEY_ID &&
  !!process.env.S3_SECRET_ACCESS_KEY &&
  !!process.env.MEDIA_PUBLIC_BASE_URL &&
  !!process.env.MEDIA_ENV_PREFIX;

const describeIfReady =
  canRunDbTests && hasS3Creds ? describe : describe.skip;

// Tiny 1×1 JPEG (decoded from base64). Real bytes — not zeros — so any
// platform-side mime sniff later doesn't reject the upload.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AD//Z",
  "base64",
);

function buildMultipartBody(args: {
  fileName: string;
  contentType: string;
  bytes: Buffer;
  boundary?: string;
}): { body: Buffer; contentType: string } {
  const boundary = args.boundary ?? "----letmepost-test-boundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${args.fileName}"\r\n` +
      `Content-Type: ${args.contentType}\r\n` +
      `\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  return {
    body: Buffer.concat([head, args.bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describeIfReady("POST /v1/media", () => {
  it("rejects non-multipart bodies", async () => {
    const { db } = await getTestDb();
    __resetS3CacheForTests();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const app = createApp({ db: tx });
      const res = await app.request("/v1/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({ ok: true }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { rule?: string } };
      expect(body.error.rule).toBe("media.content_type");
    });
  });

  it("rejects requests with no `file` part", async () => {
    const { db } = await getTestDb();
    __resetS3CacheForTests();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      const boundary = "----letmepost-empty-boundary";
      const empty = Buffer.from(`--${boundary}--\r\n`, "utf-8");

      const app = createApp({ db: tx });
      const res = await app.request("/v1/media", {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: empty,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { rule?: string } };
      expect(body.error.rule).toBe("media.missing_file");
    });
  });

  it("uploads a small image to S3 and returns a fetchable public URL", { timeout: 30_000 }, async () => {
    const { db } = await getTestDb();
    __resetS3CacheForTests();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const { body, contentType } = buildMultipartBody({
        fileName: "pixel.jpg",
        contentType: "image/jpeg",
        bytes: TINY_JPEG,
      });

      const app = createApp({ db: tx });
      const res = await app.request("/v1/media", {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body,
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as {
        id: string;
        url: string;
        contentType: string;
        sizeBytes: number;
        sha256: string;
      };
      expect(json.id).toMatch(/^med_[0-9A-Za-z]{22}$/);
      expect(json.contentType).toBe("image/jpeg");
      expect(json.sizeBytes).toBe(TINY_JPEG.length);
      expect(json.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(json.url.endsWith(`.jpg`)).toBe(true);

      const row = await tx
        .select()
        .from(mediaTable)
        .where(eq(mediaTable.id, json.id))
        .limit(1);
      expect(row).toHaveLength(1);
      expect(row[0]!.organizationId).toBe(fixture.organizationId);
      expect(row[0]!.profileId).toBe(fixture.profileId);

      // The bytes really did land in S3 and the bucket is public.
      const fetched = await fetch(json.url);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get("content-type")).toContain("image/jpeg");
      const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
      expect(fetchedBytes.equals(TINY_JPEG)).toBe(true);
    });
  });

  it("404s when a profile-scoped key targets another profile via ?profileId", async () => {
    const { db } = await getTestDb();
    __resetS3CacheForTests();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      // Mark the seed key as scoped to a fresh, empty profile so the request
      // explicitly disagrees with the api-key's scope.
      const otherProfileId = "00000000-0000-0000-0000-000000000000";

      const { body, contentType } = buildMultipartBody({
        fileName: "pixel.jpg",
        contentType: "image/jpeg",
        bytes: TINY_JPEG,
      });

      const app = createApp({ db: tx });
      const res = await app.request(
        `/v1/media?profileId=${otherProfileId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            Authorization: `Bearer ${fixture.apiKey.plaintext}`,
          },
          body,
        },
      );

      // Org-wide keys (the seed default) accept the requested profileId only
      // if it belongs to the org — `00000000-…` doesn't, so we expect 404.
      expect(res.status).toBe(404);
    });
  });
});
