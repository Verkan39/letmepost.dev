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
import { PINTEREST_IMAGE_MAX_BYTES } from "@letmepost/schemas";
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

function baseInput() {
  return {
    boardId: "board-123",
    destinationUrl: "https://example.com/product",
    imageUrl: "https://example.com/img.jpg",
    text: "caption",
  };
}

describe("validatePinterestInput — required fields", () => {
  it("accepts a fully specified input", () => {
    expect(() => validatePinterestInput(baseInput())).not.toThrow();
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

  it("rejects missing destinationUrl with pinterest.destination_url.required", () => {
    try {
      validatePinterestInput({ ...baseInput(), destinationUrl: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "pinterest.destination_url.required",
      );
    }
  });

  it("rejects missing imageUrl with pinterest.image_url.required", () => {
    try {
      validatePinterestInput({ ...baseInput(), imageUrl: "" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.image_url.required");
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

  it("rejects malformed imageUrl with image_url.http", () => {
    try {
      validatePinterestInput({ ...baseInput(), imageUrl: "not a url" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("pinterest.image_url.http");
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
