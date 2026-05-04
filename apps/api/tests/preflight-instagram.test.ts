import { describe, it, expect } from "vitest";
import {
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_MAX_CAROUSEL,
  INSTAGRAM_MAX_GRAPHEMES,
  INSTAGRAM_VIDEO_MAX_BYTES,
} from "@letmepost/schemas";
import {
  classifyInstagramPost,
  validateInstagramMedia,
  validateInstagramMediaShape,
  validateInstagramText,
  type ResolvedMediaItem,
} from "../src/platforms/instagram/preflight.js";
import { LetmepostError } from "../src/errors.js";

describe("validateInstagramText", () => {
  it("rejects text-only posts (IG has no text-only surface)", () => {
    try {
      validateInstagramText("hello", 0);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("instagram.media.required");
    }
  });

  it("accepts empty caption when media is attached", () => {
    expect(() => validateInstagramText("", 1)).not.toThrow();
  });

  it("accepts a 2200-grapheme caption", () => {
    expect(() =>
      validateInstagramText("a".repeat(INSTAGRAM_MAX_GRAPHEMES), 1),
    ).not.toThrow();
  });

  it("rejects 2201-grapheme captions", () => {
    try {
      validateInstagramText("a".repeat(INSTAGRAM_MAX_GRAPHEMES + 1), 1);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.text.max_graphemes",
      );
    }
  });
});

describe("validateInstagramMediaShape", () => {
  it("accepts up to MAX_CAROUSEL items", () => {
    const items = Array.from({ length: INSTAGRAM_MAX_CAROUSEL }, () => ({
      kind: "image" as const,
    }));
    expect(() => validateInstagramMediaShape(items)).not.toThrow();
  });

  it("rejects MAX_CAROUSEL+1 items", () => {
    try {
      validateInstagramMediaShape(
        Array.from({ length: INSTAGRAM_MAX_CAROUSEL + 1 }, () => ({
          kind: "image" as const,
        })),
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.media.count_max",
      );
    }
  });

  it("permits mixed image+video carousels", () => {
    expect(() =>
      validateInstagramMediaShape([{ kind: "image" }, { kind: "video" }]),
    ).not.toThrow();
  });
});

describe("classifyInstagramPost", () => {
  it("classifies a single image as single-image", () => {
    expect(classifyInstagramPost([{ kind: "image" }]).kind).toBe(
      "single-image",
    );
  });

  it("classifies a single video as single-video", () => {
    expect(classifyInstagramPost([{ kind: "video" }]).kind).toBe(
      "single-video",
    );
  });

  it("classifies 2+ items as carousel", () => {
    const result = classifyInstagramPost([
      { kind: "image" },
      { kind: "image" },
    ]);
    expect(result.kind).toBe("carousel");
    if (result.kind === "carousel") expect(result.childCount).toBe(2);
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

describe("validateInstagramMedia", () => {
  it("accepts a JPEG within size limits", () => {
    expect(() => validateInstagramMedia([image()])).not.toThrow();
  });

  it("rejects PNG images (IG is JPEG-only on the photo path)", () => {
    try {
      validateInstagramMedia([image({ mimeType: "image/png" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.media.mime_allowed",
      );
    }
  });

  it("rejects WebP images", () => {
    try {
      validateInstagramMedia([image({ mimeType: "image/webp" })]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.media.mime_allowed",
      );
    }
  });

  it("rejects oversized images (> 8 MB)", () => {
    try {
      validateInstagramMedia([
        image({ byteLength: INSTAGRAM_IMAGE_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.media.image_size_max",
      );
    }
  });

  it("rejects oversized videos (> 1 GB)", () => {
    try {
      validateInstagramMedia([
        video({ byteLength: INSTAGRAM_VIDEO_MAX_BYTES + 1 }),
      ]);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "instagram.media.video_size_max",
      );
    }
  });
});
