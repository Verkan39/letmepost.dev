import { describe, it, expect } from "vitest";
import {
  countGraphemes,
  validateBlueskyText,
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
    expect(countGraphemes("é")).toBe(1);
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
