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
import { PINTEREST_IMAGE_MAX_BYTES, type MediaInput } from "@letmepost/schemas";
import {
  assertPinterestUrlsReachable,
  validatePinterestInput,
} from "../src/platforms/pinterest/preflight.js";
import { LetmepostError } from "../src/errors.js";

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const imageItem: MediaInput = {
  kind: "image",
  url: "https://example.com/img.jpg",
};

function baseInput() {
  return {
    boardId: "board-123",
    destinationUrl: "https://example.com/product",
    text: "caption",
    media: [imageItem],
  };
}

describe("validatePinterestInput — required fields", () => {
  it("accepts a fully specified input", () => {
    expect(() => validatePinterestInput(baseInput())).not.toThrow();
  });

  it("accepts input without an explicit destinationUrl", () => {
    const { destinationUrl: _, ...rest } = baseInput();
    expect(() => validatePinterestInput(rest)).not.toThrow();
  });

  it("rejects missing boardId with pinterest.board.required", () => {
    try {
      validatePinterestInput({ ...baseInput(), boardId: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.board.required");
    }
  });

  it("rejects missing media with pinterest.media.required", () => {
    try {
      validatePinterestInput({ ...baseInput(), media: [] });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.media.required");
    }
  });

  it("rejects multi-media with pinterest.media.single_only", () => {
    try {
      validatePinterestInput({
        ...baseInput(),
        media: [imageItem, imageItem],
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "pinterest.media.single_only",
      );
    }
  });

  it("rejects video media with pinterest.media.image_only", () => {
    try {
      validatePinterestInput({
        ...baseInput(),
        media: [{ kind: "video", url: "https://example.com/v.mp4" }],
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.media.image_only");
    }
  });

  it("rejects non-http destinationUrl with destination_url.http", () => {
    try {
      validatePinterestInput({
        ...baseInput(),
        destinationUrl: "ftp://example.com",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "pinterest.destination_url.http",
      );
    }
  });
});

describe("assertPinterestUrlsReachable", () => {
  it("passes when both URLs return 200 with a supported image mime", async () => {
    server.use(
      http.get(
        "https://example.com/product",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.get(
        "https://example.com/img.jpg",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    );
    await expect(
      assertPinterestUrlsReachable({
        destinationUrl: "https://example.com/product",
        imageUrl: "https://example.com/img.jpg",
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when no destinationUrl is provided", async () => {
    server.use(
      http.get(
        "https://example.com/img.jpg",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    );
    await expect(
      assertPinterestUrlsReachable({
        imageUrl: "https://example.com/img.jpg",
      }),
    ).resolves.toBeUndefined();
  });

  it("fails with pinterest.destination_url.reachable when destination 404s", async () => {
    server.use(
      http.get(
        "https://example.com/missing",
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(
        "https://example.com/img.jpg",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    );
    try {
      await assertPinterestUrlsReachable({
        destinationUrl: "https://example.com/missing",
        imageUrl: "https://example.com/img.jpg",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "pinterest.destination_url.reachable",
      );
    }
  });

  it("fails with pinterest.image.mime_allowed on an unsupported mime", async () => {
    server.use(
      http.get(
        "https://example.com/product",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.get(
        "https://example.com/bad.heic",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { "Content-Type": "image/heic" },
          }),
      ),
    );
    try {
      await assertPinterestUrlsReachable({
        destinationUrl: "https://example.com/product",
        imageUrl: "https://example.com/bad.heic",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.image.mime_allowed");
    }
  });

  it("fails with pinterest.image.size_max when content-length exceeds the limit", async () => {
    server.use(
      http.get(
        "https://example.com/product",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.get(
        "https://example.com/big.jpg",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": String(PINTEREST_IMAGE_MAX_BYTES + 1),
            },
          }),
      ),
    );
    try {
      await assertPinterestUrlsReachable({
        destinationUrl: "https://example.com/product",
        imageUrl: "https://example.com/big.jpg",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.image.size_max");
    }
  });

  it("accepts image when no content-length header is present (server didn't tell us the size)", async () => {
    server.use(
      http.get(
        "https://example.com/product",
        () => new HttpResponse(null, { status: 200 }),
      ),
      http.get(
        "https://example.com/unknown-size.jpg",
        () =>
          new HttpResponse(null, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          }),
      ),
    );
    await expect(
      assertPinterestUrlsReachable({
        destinationUrl: "https://example.com/product",
        imageUrl: "https://example.com/unknown-size.jpg",
      }),
    ).resolves.toBeUndefined();
  });
});
