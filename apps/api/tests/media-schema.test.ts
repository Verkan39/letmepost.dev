import { describe, expect, it } from "vitest";
import { MediaInput } from "@letmepost/schemas";

describe("MediaInput schema", () => {
  it("accepts the mediaId variant for image", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      mediaId: "med_abcdefghijklmnopqrstuv",
      altText: "alt",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the mediaId variant for video", () => {
    const result = MediaInput.safeParse({
      kind: "video",
      mediaId: "med_ABCDEFGHIJKLMNOPqrstuv",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts the url variant", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      url: "https://cdn.example.com/x.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts the bytesBase64 variant", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      bytesBase64: "AAAA",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when mediaId and url are both supplied", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      mediaId: "med_abcdefghijklmnopqrstuv",
      url: "https://cdn.example.com/x.jpg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when mediaId and bytesBase64 are both supplied", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      mediaId: "med_abcdefghijklmnopqrstuv",
      bytesBase64: "AAAA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when none of mediaId/url/bytesBase64 are supplied", () => {
    const result = MediaInput.safeParse({ kind: "image" });
    expect(result.success).toBe(false);
  });

  it("rejects malformed mediaId values", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      // missing the `med_` prefix
      mediaId: "abcdefghijklmnopqrstuv12",
    });
    expect(result.success).toBe(false);
  });

  it("rejects mediaId values that are too short", () => {
    const result = MediaInput.safeParse({
      kind: "image",
      mediaId: "med_short",
    });
    expect(result.success).toBe(false);
  });
});
