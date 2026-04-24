import { describe, it, expect } from "vitest";
import {
  BLUESKY_ALT_TEXT_MAX_GRAPHEMES,
  BLUESKY_IMAGE_MAX_BYTES,
  BLUESKY_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import {
  countGraphemes,
  validateBlueskyFirstComment,
  validateBlueskyMedia,
  validateBlueskyText,
  type ResolvedMediaItem,
} from "../src/platforms/bluesky/preflight.js";
import { LetmepostError } from "../src/errors.js";

describe("countGraphemes", () => {
  it("counts ascii characters as individual graphemes", () => {
    expect(countGraphemes("hello")).toBe(5);
  });

  it("counts a single emoji as one grapheme", () => {
    expect(countGraphemes("🎉")).toBe(1);
  });

  it("counts a compound family emoji as one grapheme", () => {
    expect(countGraphemes("👨‍👩‍👧‍👦")).toBe(1);
  });

  it("treats combining marks as part of the base grapheme", () => {
    expect(countGraphemes("é")).toBe(1);
    expect(countGraphemes("é")).toBe(1);
  });
});

describe("validateBlueskyText", () => {
  it("accepts text within 300 graphemes", () => {
    expect(() => validateBlueskyText("a".repeat(300))).not.toThrow();
  });

  it("rejects text over 300 graphemes with a specific rule id", () => {
    try {
      validateBlueskyText("a".repeat(301));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      const e = err as LetmepostError;
      expect(e.code).toBe("preflight_failed");
      expect(e.rule).toBe("bluesky.text.max_graphemes");
      expect(e.platform).toBe("bluesky");
      expect(e.status).toBe(400);
      expect(e.remediation).toBeDefined();
    }
  });

  it("rejects empty text", () => {
    expect(() => validateBlueskyText("")).toThrow(LetmepostError);
  });

  it("rejects whitespace-only text with the non-empty rule", () => {
    try {
      validateBlueskyText("   \n\t  ");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.text.non_empty");
    }
  });

  it("uses grapheme counting, not UTF-16 code units, for the limit", () => {
    // 150 family emojis = 150 graphemes, but 1,650+ UTF-16 code units.
    // Should PASS because graphemes (150) <= 300.
    const text = "👨‍👩‍👧‍👦".repeat(150);
    expect(() => validateBlueskyText(text)).not.toThrow();
  });
});

function image(overrides: Partial<ResolvedMediaItem> = {}): ResolvedMediaItem {
  return {
    kind: "image",
    mimeType: "image/jpeg",
    byteLength: 10_000,
    ...overrides,
  };
}

function video(overrides: Partial<ResolvedMediaItem> = {}): ResolvedMediaItem {
  return {
    kind: "video",
    mimeType: "video/mp4",
    byteLength: 1_000_000,
    ...overrides,
  };
}

describe("validateBlueskyMedia", () => {
  it("accepts an empty media list", () => {
    expect(() => validateBlueskyMedia([])).not.toThrow();
  });

  it("accepts up to 4 images", () => {
    expect(() =>
      validateBlueskyMedia([image(), image(), image(), image()]),
    ).not.toThrow();
  });

  it("rejects 5 images with count_max", () => {
    try {
      validateBlueskyMedia([image(), image(), image(), image(), image()]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.media.count_max");
    }
  });

  it("rejects mixing images and video with image_video_exclusive", () => {
    try {
      validateBlueskyMedia([image(), video()]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "bluesky.media.image_video_exclusive",
      );
    }
  });

  it("rejects an oversized image with image_size_max", () => {
    try {
      validateBlueskyMedia([image({ byteLength: BLUESKY_IMAGE_MAX_BYTES + 1 })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.media.image_size_max");
    }
  });

  it("rejects an oversized video with video_size_max", () => {
    try {
      validateBlueskyMedia([video({ byteLength: BLUESKY_VIDEO_MAX_BYTES + 1 })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.media.video_size_max");
    }
  });

  it("rejects a disallowed image mime with mime_allowed", () => {
    try {
      validateBlueskyMedia([image({ mimeType: "image/heic" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.media.mime_allowed");
    }
  });

  it("rejects a non-mp4 video with mime_allowed", () => {
    try {
      validateBlueskyMedia([video({ mimeType: "video/webm" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("bluesky.media.mime_allowed");
    }
  });

  it("rejects overlong alt text with alt_text_max_graphemes", () => {
    try {
      validateBlueskyMedia([
        image({ altText: "a".repeat(BLUESKY_ALT_TEXT_MAX_GRAPHEMES + 1) }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "bluesky.media.alt_text_max_graphemes",
      );
    }
  });

  it("accepts alt text at the grapheme limit", () => {
    expect(() =>
      validateBlueskyMedia([
        image({ altText: "a".repeat(BLUESKY_ALT_TEXT_MAX_GRAPHEMES) }),
      ]),
    ).not.toThrow();
  });
});

describe("validateBlueskyFirstComment", () => {
  it("accepts 300-grapheme text", () => {
    expect(() => validateBlueskyFirstComment("a".repeat(300))).not.toThrow();
  });

  it("rejects empty first comment text with non_empty", () => {
    try {
      validateBlueskyFirstComment("   ");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "bluesky.first_comment.non_empty",
      );
    }
  });

  it("rejects over-300-grapheme text with max_graphemes", () => {
    try {
      validateBlueskyFirstComment("a".repeat(301));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe(
        "bluesky.first_comment.max_graphemes",
      );
    }
  });
});
