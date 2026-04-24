import { describe, expect, it } from "vitest";
import { LINKEDIN_MAX_GRAPHEMES } from "@letmepost/schemas";
import { LetmepostError } from "../src/errors.js";
import {
  validateLinkedInAuthor,
  validateLinkedInInput,
  validateLinkedInText,
  validateLinkedInVisibility,
} from "../src/platforms/linkedin/preflight.js";

describe("LinkedIn preflight: text", () => {
  it("accepts a non-empty short string", () => {
    expect(() => validateLinkedInText("hello")).not.toThrow();
  });

  it("rejects empty text with `linkedin.text.non_empty`", () => {
    try {
      validateLinkedInText("");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LetmepostError);
      expect((err as LetmepostError).code).toBe("preflight_failed");
      expect((err as LetmepostError).rule).toBe("linkedin.text.non_empty");
    }
  });

  it(`rejects text longer than ${LINKEDIN_MAX_GRAPHEMES} graphemes`, () => {
    const text = "a".repeat(LINKEDIN_MAX_GRAPHEMES + 1);
    try {
      validateLinkedInText(text);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("linkedin.text.max_graphemes");
    }
  });

  it("counts emoji + ZWJ as a single grapheme (family emoji is 1, not 7)", () => {
    // Family emoji = ZWJ-joined sequence — should count as 1 grapheme.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const long = family.repeat(LINKEDIN_MAX_GRAPHEMES); // exactly at the cap
    expect(() => validateLinkedInText(long)).not.toThrow();
    const tooLong = family.repeat(LINKEDIN_MAX_GRAPHEMES + 1);
    expect(() => validateLinkedInText(tooLong)).toThrow(LetmepostError);
  });
});

describe("LinkedIn preflight: author URN", () => {
  it("accepts a valid person URN", () => {
    expect(() =>
      validateLinkedInAuthor("urn:li:person:abc123-DEF_xyz"),
    ).not.toThrow();
  });

  it("rejects an org URN with the MDP-only remediation", () => {
    try {
      validateLinkedInAuthor("urn:li:organization:42");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe(
        "linkedin.author.org_not_supported",
      );
      expect((err as LetmepostError).remediation).toMatch(/MDP/);
    }
  });

  it("rejects malformed URNs with the format rule", () => {
    try {
      validateLinkedInAuthor("urn:li:foo:1");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("linkedin.author.urn_format");
    }
  });

  it("rejects empty author", () => {
    expect(() => validateLinkedInAuthor("")).toThrow(LetmepostError);
  });
});

describe("LinkedIn preflight: visibility", () => {
  it("accepts undefined (defaults applied later)", () => {
    expect(() => validateLinkedInVisibility(undefined)).not.toThrow();
  });

  it("accepts PUBLIC and CONNECTIONS", () => {
    expect(() => validateLinkedInVisibility("PUBLIC")).not.toThrow();
    expect(() => validateLinkedInVisibility("CONNECTIONS")).not.toThrow();
  });

  it("rejects anything else with `linkedin.visibility.enum`", () => {
    try {
      validateLinkedInVisibility("PRIVATE");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as LetmepostError).rule).toBe("linkedin.visibility.enum");
    }
  });
});

describe("LinkedIn preflight: input bundle", () => {
  it("validateLinkedInInput composes all three checks", () => {
    expect(() =>
      validateLinkedInInput({
        text: "hi",
        authorUrn: "urn:li:person:abc",
        visibility: "PUBLIC",
      }),
    ).not.toThrow();
    expect(() =>
      validateLinkedInInput({
        text: "",
        authorUrn: "urn:li:person:abc",
      }),
    ).toThrow(LetmepostError);
    expect(() =>
      validateLinkedInInput({
        text: "hi",
        authorUrn: "urn:li:organization:1",
      }),
    ).toThrow(LetmepostError);
  });
});
