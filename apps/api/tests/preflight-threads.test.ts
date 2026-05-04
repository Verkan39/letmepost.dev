import { describe, it, expect } from "vitest";
import {
  THREADS_ALT_TEXT_MAX_GRAPHEMES,
  THREADS_IMAGE_MAX_BYTES,
  THREADS_MAX_CAROUSEL,
  THREADS_MAX_GRAPHEMES,
  THREADS_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import {
  validateThreadsMedia,
  validateThreadsMediaShape,
  validateThreadsText,
  type ResolvedMediaItem,
} from "../src/platforms/threads/preflight.js";
import { LetmepostError } from "../src/errors.js";

describe("validateThreadsText", () => {
  it("accepts text within 500 graphemes", () => {
    expect(() => validateThreadsText("a".repeat(500), 0)).not.toThrow();
  });

  it("rejects text over 500 graphemes", () => {
    try {
      validateThreadsText("a".repeat(501), 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      const e = err as LetmepostError;
      expect(e.rule).toBe("threads.text.max_graphemes");
      expect(e.platform).toBe("threads");
    }
  });

  it("requires non-empty text on text-only posts", () => {
    try {
      validateThreadsText("", 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("threads.text.required");
    }
  });

  it("allows empty text when media is attached (caption is optional)", () => {
    expect(() => validateThreadsText("", 1)).not.toThrow();
    expect(() => validateThreadsText("", 4)).not.toThrow();
  });

  it("uses grapheme counting, not UTF-16 code units", () => {
    // 250 family emojis = 250 graphemes, well under the 500 cap, even though
    // UTF-16 .length would be 2,750+.
    expect(() =>
      validateThreadsText("👨‍👩‍👧‍👦".repeat(250), 0),
    ).not.toThrow();
  });
});

function image(
  overrides: Partial<ResolvedMediaItem> = {},
): ResolvedMediaItem {
  return {
    kind: "image",
    mimeType: "image/jpeg",
    byteLength: 100_000,
    ...overrides,
  };
}

function video(
  overrides: Partial<ResolvedMediaItem> = {},
): ResolvedMediaItem {
  return {
    kind: "video",
    mimeType: "video/mp4",
    byteLength: 1_000_000,
    ...overrides,
  };
}

describe("validateThreadsMediaShape", () => {
  it("accepts an empty media list", () => {
    expect(() => validateThreadsMediaShape([])).not.toThrow();
  });

  it("accepts up to MAX_CAROUSEL items", () => {
    const items = Array.from({ length: THREADS_MAX_CAROUSEL }, () => ({
      kind: "image" as const,
    }));
    expect(() => validateThreadsMediaShape(items)).not.toThrow();
  });

  it("rejects MAX_CAROUSEL+1 items with count_max", () => {
    const items = Array.from({ length: THREADS_MAX_CAROUSEL + 1 }, () => ({
      kind: "image" as const,
    }));
    try {
      validateThreadsMediaShape(items);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("threads.media.count_max");
    }
  });

  it("permits mixed image + video carousels (Threads allows this)", () => {
    expect(() =>
      validateThreadsMediaShape([
        { kind: "image" },
        { kind: "video" },
        { kind: "image" },
      ]),
    ).not.toThrow();
  });

  it("rejects alt text > MAX_ALT_TEXT_GRAPHEMES", () => {
    try {
      validateThreadsMediaShape([
        {
          kind: "image",
          altText: "a".repeat(THREADS_ALT_TEXT_MAX_GRAPHEMES + 1),
        },
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "threads.media.alt_text_max_graphemes",
      );
    }
  });
});

describe("validateThreadsMedia", () => {
  it("accepts a single image within size + mime limits", () => {
    expect(() => validateThreadsMedia([image()])).not.toThrow();
  });

  it("accepts a single mp4 video within size + mime limits", () => {
    expect(() => validateThreadsMedia([video()])).not.toThrow();
  });

  it("rejects unsupported image mime", () => {
    try {
      validateThreadsMedia([image({ mimeType: "image/avif" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("threads.media.mime_allowed");
    }
  });

  it("rejects unsupported video mime", () => {
    try {
      validateThreadsMedia([video({ mimeType: "video/webm" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("threads.media.mime_allowed");
    }
  });

  it("rejects oversized images", () => {
    try {
      validateThreadsMedia([
        image({ byteLength: THREADS_IMAGE_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "threads.media.image_size_max",
      );
    }
  });

  it("rejects oversized videos", () => {
    try {
      validateThreadsMedia([
        video({ byteLength: THREADS_VIDEO_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "threads.media.video_size_max",
      );
    }
  });

  it("skips byte-size checks for items with unknown byteLength (raw URL inputs)", () => {
    // mediaId path always has byteLength via the row's contentType+sizeBytes,
    // but a raw URL input goes through resolveMediaToUrl with mimeType
    // optional. Preflight should not reject for missing bytes.
    expect(() =>
      validateThreadsMedia([{ kind: "image", mimeType: "image/jpeg" }]),
    ).not.toThrow();
  });

  it("accepts QuickTime (mov) videos as well as mp4", () => {
    expect(() =>
      validateThreadsMedia([video({ mimeType: "video/quicktime" })]),
    ).not.toThrow();
  });
});
