import { describe, expect, it } from "vitest";
import {
  TWITTER_GIF_MAX_BYTES,
  TWITTER_IMAGE_MAX_BYTES,
  TWITTER_MAX_GRAPHEMES,
  TWITTER_TCO_URL_LENGTH,
  TWITTER_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import {
  countTwitterWeightedGraphemes,
  validateTwitterMedia,
  validateTwitterText,
  type TwitterResolvedMediaItem,
} from "../src/platforms/twitter/preflight.js";
import { LetmepostError } from "../src/errors.js";

describe("countTwitterWeightedGraphemes", () => {
  it("counts plain ascii by grapheme", () => {
    expect(countTwitterWeightedGraphemes("hello world")).toBe(11);
  });

  it("treats a compound emoji as one grapheme", () => {
    expect(countTwitterWeightedGraphemes("👨‍👩‍👧‍👦")).toBe(1);
  });

  it("wraps a URL to t.co weight regardless of real length", () => {
    const short = "https://a.co/x";
    const long =
      "https://really-long-subdomain.example.com/path/to/a/very/deeply/nested/resource?query=foo&more=bar";
    expect(countTwitterWeightedGraphemes(short)).toBe(TWITTER_TCO_URL_LENGTH);
    expect(countTwitterWeightedGraphemes(long)).toBe(TWITTER_TCO_URL_LENGTH);
  });

  it("adds t.co weight per URL in a longer text", () => {
    const text = "look: https://a.co and https://b.co";
    // "look: " = 6, 2 URLs wrapped to 23 each, " and " = 5 → 6 + 23 + 5 + 23 = 57
    expect(countTwitterWeightedGraphemes(text)).toBe(57);
  });
});

describe("validateTwitterText", () => {
  it("accepts 280-grapheme text", () => {
    expect(() => validateTwitterText("a".repeat(280))).not.toThrow();
  });

  it("rejects 281-grapheme text with twitter.text.max_graphemes", () => {
    try {
      validateTwitterText("a".repeat(281));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      const e = err as LetmepostError;
      expect(e.code).toBe("preflight_failed");
      expect(e.rule).toBe("twitter.text.max_graphemes");
      expect(e.platform).toBe("twitter");
    }
  });

  it("rejects empty text with twitter.text.non_empty", () => {
    try {
      validateTwitterText("   ");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.text.non_empty");
    }
  });

  it("accepts a tweet that only fits because the URL was shortened", () => {
    // Real length: 280 chars of 'a' + a 100-char URL → 380. Weighted: 280 + 23 = 303. Still over.
    // But with 200 a's + a 200-char URL: weighted = 200 + 23 = 223. Under.
    const tweet = "a".repeat(200) + " " + "https://example.com/" + "b".repeat(180);
    expect(countTwitterWeightedGraphemes(tweet)).toBeLessThan(TWITTER_MAX_GRAPHEMES);
    expect(() => validateTwitterText(tweet)).not.toThrow();
  });

  it("rejects when real-length is fine but weighted length exceeds the limit", () => {
    // 270 a's + ' ' + short URL: real = 270 + 1 + 16 ≈ 287; weighted = 270 + 1 + 23 = 294 → over 280.
    const tweet = "a".repeat(270) + " https://a.co/x";
    expect(() => validateTwitterText(tweet)).toThrow(LetmepostError);
  });

  it("uses grapheme count for emoji-heavy text", () => {
    // 140 family emojis = 140 graphemes, well under 280.
    const text = "👨‍👩‍👧‍👦".repeat(140);
    expect(() => validateTwitterText(text)).not.toThrow();
  });
});

function image(
  overrides: Partial<TwitterResolvedMediaItem> = {},
): TwitterResolvedMediaItem {
  return {
    kind: "image",
    mimeType: "image/jpeg",
    byteLength: 10_000,
    ...overrides,
  };
}

function video(
  overrides: Partial<TwitterResolvedMediaItem> = {},
): TwitterResolvedMediaItem {
  return {
    kind: "video",
    mimeType: "video/mp4",
    byteLength: 10_000_000,
    ...overrides,
  };
}

describe("validateTwitterMedia", () => {
  it("accepts empty media", () => {
    expect(() => validateTwitterMedia([])).not.toThrow();
  });

  it("accepts a single image", () => {
    expect(() => validateTwitterMedia([image()])).not.toThrow();
  });

  it("accepts a single video", () => {
    expect(() => validateTwitterMedia([video()])).not.toThrow();
  });

  it("accepts a single gif", () => {
    expect(() =>
      validateTwitterMedia([image({ mimeType: "image/gif" })]),
    ).not.toThrow();
  });

  it("rejects 2 media items with twitter.media.single_only (MVP)", () => {
    try {
      validateTwitterMedia([image(), image()]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.single_only");
    }
  });

  it("rejects disallowed image mime with twitter.media.mime_allowed", () => {
    try {
      validateTwitterMedia([image({ mimeType: "image/heic" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.mime_allowed");
    }
  });

  it("rejects non-mp4 video with twitter.media.mime_allowed", () => {
    try {
      validateTwitterMedia([video({ mimeType: "video/webm" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.mime_allowed");
    }
  });

  it("rejects oversized image with twitter.media.image_size_max", () => {
    try {
      validateTwitterMedia([image({ byteLength: TWITTER_IMAGE_MAX_BYTES + 1 })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.image_size_max");
    }
  });

  it("rejects oversized gif with twitter.media.gif_size_max", () => {
    try {
      validateTwitterMedia([
        image({
          mimeType: "image/gif",
          byteLength: TWITTER_GIF_MAX_BYTES + 1,
        }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.gif_size_max");
    }
  });

  it("rejects oversized video with twitter.media.video_size_max", () => {
    try {
      validateTwitterMedia([video({ byteLength: TWITTER_VIDEO_MAX_BYTES + 1 })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).rule).toBe("twitter.media.video_size_max");
    }
  });
});
