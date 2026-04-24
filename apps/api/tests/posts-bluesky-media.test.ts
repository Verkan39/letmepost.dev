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

// Small base64 payload — exact bytes don't matter since we stub uploadBlob.
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AD//Z";

function sessionHandler(did = "did:plc:test") {
  return http.post(
    "https://bsky.social/xrpc/com.atproto.server.createSession",
    () =>
      HttpResponse.json({
        accessJwt: "access",
        refreshJwt: "refresh",
        did,
        handle: "alice.bsky.social",
      }),
  );
}

function uploadBlobOk(size = 1234) {
  let counter = 0;
  return http.post(
    "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
    () => {
      counter++;
      return HttpResponse.json({
        blob: {
          $type: "blob",
          ref: { $link: `bafkreiblob${counter}` },
          mimeType: "image/jpeg",
          size,
        },
      });
    },
  );
}

function createRecordOk(uri: string, cid: string) {
  return http.post(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    () => HttpResponse.json({ uri, cid }),
  );
}

type RecordResult =
  | { uri: string; cid: string }
  | { status: number; body: Record<string, unknown> };

function createRecordSequence(results: RecordResult[]) {
  let i = 0;
  return http.post(
    "https://bsky.social/xrpc/com.atproto.repo.createRecord",
    () => {
      const result = results[Math.min(i, results.length - 1)]!;
      i++;
      if ("status" in result) {
        return HttpResponse.json(result.body, { status: result.status });
      }
      return HttpResponse.json(result);
    },
  );
}

describeIfDb("POST /v1/posts (bluesky, media)", () => {
  it("publishes a post with a single image", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        uploadBlobOk(),
        createRecordOk("at://did:plc:test/app.bsky.feed.post/main1", "bafy-main"),
      );

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "one image",
          media: [
            { kind: "image", bytesBase64: TINY_JPEG_BASE64, altText: "a pixel" },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        platform: string;
        uri?: string;
        cid?: string;
      };
      expect(body.platform).toBe("bluesky");
      expect(body.cid).toBe("bafy-main");
    });
  });

  it("publishes a 4-image carousel", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        uploadBlobOk(),
        createRecordOk(
          "at://did:plc:test/app.bsky.feed.post/carousel",
          "bafy-carousel",
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
          account: { platform: "bluesky", id: fixture.accountId },
          text: "four images",
          media: Array.from({ length: 4 }, () => ({
            kind: "image",
            bytesBase64: TINY_JPEG_BASE64,
          })),
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { cid?: string };
      expect(body.cid).toBe("bafy-carousel");
    });
  });

  it("publishes a single video", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        http.post(
          "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
          () =>
            HttpResponse.json({
              blob: {
                $type: "blob",
                ref: { $link: "bafkreivid" },
                mimeType: "video/mp4",
                size: 999,
              },
            }),
        ),
        createRecordOk("at://did:plc:test/app.bsky.feed.post/video", "bafy-video"),
      );

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "a video",
          media: [
            {
              kind: "video",
              // 8 bytes of zeros. When resolved via bytesBase64, mime defaults
              // to video/mp4 per the publisher heuristic.
              bytesBase64: "AAAAAAAAAAA=",
              altText: "a clip",
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { cid?: string };
      expect(body.cid).toBe("bafy-video");
    });
  });

  it("rejects 5 images before any upstream call", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      // Intentionally no handlers — a call through would raise unhandled.

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "too many",
          media: Array.from({ length: 5 }, () => ({
            kind: "image",
            bytesBase64: TINY_JPEG_BASE64,
          })),
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.count_max");
    });
  });

  it("rejects mixing images and video", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "mixed",
          media: [
            { kind: "image", bytesBase64: TINY_JPEG_BASE64 },
            { kind: "video", bytesBase64: "AAAA" },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.image_video_exclusive");
    });
  });

  it("rejects an oversized image", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      // 1.1 MB image: base64 of 1_100_000 bytes.
      const bigBytes = new Uint8Array(1_100_000);
      const bigBase64 = Buffer.from(bigBytes).toString("base64");

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "big image",
          media: [{ kind: "image", bytesBase64: bigBase64 }],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.image_size_max");
    });
  });

  it("rejects an oversized video (fetched via URL)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      const bigVideo = new Uint8Array(101_000_000);
      server.use(
        http.get("https://example.test/big.mp4", () =>
          HttpResponse.arrayBuffer(bigVideo.buffer, {
            headers: { "Content-Type": "video/mp4" },
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
          account: { platform: "bluesky", id: fixture.accountId },
          text: "huge video",
          media: [{ kind: "video", url: "https://example.test/big.mp4" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.video_size_max");
    });
  });

  it("rejects a bad image mime type (fetched via URL)", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        http.get("https://example.test/bad.heic", () =>
          HttpResponse.arrayBuffer(new Uint8Array(10).buffer, {
            headers: { "Content-Type": "image/heic" },
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
          account: { platform: "bluesky", id: fixture.accountId },
          text: "bad mime",
          media: [{ kind: "image", url: "https://example.test/bad.heic" }],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.mime_allowed");
    });
  });

  it("rejects overlong alt text", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "alt too long",
          media: [
            {
              kind: "image",
              bytesBase64: TINY_JPEG_BASE64,
              altText: "a".repeat(2001),
            },
          ],
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.media.alt_text_max_graphemes");
    });
  });

  it("surfaces uploadBlob 413 as platform_rejected", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        http.post(
          "https://bsky.social/xrpc/com.atproto.repo.uploadBlob",
          () =>
            HttpResponse.json(
              { error: "PayloadTooLarge", message: "blob too large" },
              { status: 413 },
            ),
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
          account: { platform: "bluesky", id: fixture.accountId },
          text: "will fail upload",
          media: [{ kind: "image", bytesBase64: TINY_JPEG_BASE64 }],
        }),
      });

      expect(res.status).toBe(502);
      const body = (await res.json()) as {
        error: { code: string; platform?: string; platformResponse?: unknown };
      };
      expect(body.error.code).toBe("platform_rejected");
      expect(body.error.platform).toBe("bluesky");
      expect(body.error.platformResponse).toMatchObject({
        error: "PayloadTooLarge",
      });
    });
  });
});

describeIfDb("POST /v1/posts (bluesky, first comment)", () => {
  it("publishes a text-only post with a first-comment reply", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        createRecordSequence([
          { uri: "at://did:plc:test/app.bsky.feed.post/main", cid: "bafy-main" },
          { uri: "at://did:plc:test/app.bsky.feed.post/reply", cid: "bafy-reply" },
        ]),
      );

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "main thread",
          firstComment: { text: "follow-up comment" },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        cid?: string;
        firstCommentUri?: string;
        firstCommentCid?: string;
      };
      expect(body.cid).toBe("bafy-main");
      expect(body.firstCommentUri).toMatch(/app\.bsky\.feed\.post\/reply/);
      expect(body.firstCommentCid).toBe("bafy-reply");
    });
  });

  it("publishes an image post with a first-comment reply", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        uploadBlobOk(),
        createRecordSequence([
          { uri: "at://did:plc:test/app.bsky.feed.post/m", cid: "bafy-m" },
          { uri: "at://did:plc:test/app.bsky.feed.post/r", cid: "bafy-r" },
        ]),
      );

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "photo",
          media: [{ kind: "image", bytesBase64: TINY_JPEG_BASE64 }],
          firstComment: { text: "source link in replies" },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { firstCommentCid?: string };
      expect(body.firstCommentCid).toBe("bafy-r");
    });
  });

  it("rejects an empty first-comment text", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "main",
          firstComment: { text: "   " },
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.first_comment.non_empty");
    });
  });

  it("rejects an over-300-grapheme first-comment", async () => {
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "main",
          firstComment: { text: "a".repeat(301) },
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; rule?: string };
      };
      expect(body.error.code).toBe("preflight_failed");
      expect(body.error.rule).toBe("bluesky.first_comment.max_graphemes");
    });
  });

  it("returns the main post with a warning when the first-comment reply fails", async () => {
    // Design choice: if the main post is already live on the PDS, we do NOT
    // roll back or fail the request. The user's content is published. We
    // surface the first-comment failure as a non-fatal warning under
    // `warnings[].code = "first_comment_failed"` so the caller can retry the
    // reply independently. A hard failure here would be lossy — we can't
    // un-publish.
    const { db } = await getTestDb();
    await runInTransaction(db, async (tx) => {
      const fixture = await seed(tx);
      server.use(
        sessionHandler(),
        createRecordSequence([
          { uri: "at://did:plc:test/app.bsky.feed.post/ok", cid: "bafy-ok" },
          {
            status: 400,
            body: { error: "InvalidRequest", message: "reply blocked" },
          },
        ]),
      );

      const app = createApp({ db: tx });
      const res = await app.request("/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${fixture.apiKey.plaintext}`,
        },
        body: JSON.stringify({
          account: { platform: "bluesky", id: fixture.accountId },
          text: "main ok",
          firstComment: { text: "reply will fail" },
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        cid?: string;
        firstCommentCid?: string;
        warnings?: Array<{ code: string }>;
      };
      expect(body.cid).toBe("bafy-ok");
      expect(body.firstCommentCid).toBeUndefined();
      expect(body.warnings?.[0]?.code).toBe("first_comment_failed");
    });
  });
});
