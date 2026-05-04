import { describe, it, expect } from "vitest";
import {
  FACEBOOK_IMAGE_MAX_BYTES,
  FACEBOOK_MAX_GRAPHEMES,
  FACEBOOK_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import {
  validateFacebookMedia,
  validateFacebookMediaShape,
  validateFacebookText,
  type ResolvedMediaItem,
} from "../src/platforms/facebook/preflight.js";
import { LetmepostError } from "../src/errors.js";

describe("validateFacebookText", () => {
  it("accepts text under the FB cap", () => {
    expect(() => validateFacebookText("hello world", 0)).not.toThrow();
  });

  it("requires non-empty text on text-only posts", () => {
    try {
      validateFacebookText("", 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("facebook.text.required");
    }
  });

  it("allows empty text when media is attached", () => {
    expect(() => validateFacebookText("", 1)).not.toThrow();
  });

  it("rejects text > 63206 graphemes", () => {
    try {
      validateFacebookText("a".repeat(FACEBOOK_MAX_GRAPHEMES + 1), 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("facebook.text.max_graphemes");
    }
  });
});

describe("validateFacebookMediaShape", () => {
  it("accepts a single image", () => {
    expect(() =>
      validateFacebookMediaShape([{ kind: "image" }]),
    ).not.toThrow();
  });

  it("accepts multi-image (no upper bound on FB Page multi-photo)", () => {
    expect(() =>
      validateFacebookMediaShape(
        Array.from({ length: 8 }, () => ({ kind: "image" as const })),
      ),
    ).not.toThrow();
  });

  it("rejects mixed image + video", () => {
    try {
      validateFacebookMediaShape([{ kind: "image" }, { kind: "video" }]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "facebook.media.image_video_exclusive",
      );
    }
  });

  it("rejects multiple videos", () => {
    try {
      validateFacebookMediaShape([{ kind: "video" }, { kind: "video" }]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("facebook.media.count_max");
    }
  });
});

function image(
  overrides: Partial<ResolvedMediaItem> = {},
): ResolvedMediaItem {
  return { kind: "image", mimeType: "image/jpeg", byteLength: 100_000, ...overrides };
}

function video(
  overrides: Partial<ResolvedMediaItem> = {},
): ResolvedMediaItem {
  return { kind: "video", mimeType: "video/mp4", byteLength: 1_000_000, ...overrides };
}

describe("validateFacebookMedia", () => {
  it("accepts a JPEG within size limits", () => {
    expect(() => validateFacebookMedia([image()])).not.toThrow();
  });

  it("accepts an MP4 within size limits", () => {
    expect(() => validateFacebookMedia([video()])).not.toThrow();
  });

  it("rejects unsupported image mime", () => {
    try {
      validateFacebookMedia([image({ mimeType: "image/avif" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("facebook.media.mime_allowed");
    }
  });

  it("rejects oversized images", () => {
    try {
      validateFacebookMedia([
        image({ byteLength: FACEBOOK_IMAGE_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "facebook.media.image_size_max",
      );
    }
  });

  it("rejects oversized videos", () => {
    try {
      validateFacebookMedia([
        video({ byteLength: FACEBOOK_VIDEO_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "facebook.media.video_size_max",
      );
    }
  });
});
