import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetKekCacheForTests,
  decrypt,
  encrypt,
} from "../../src/encryption/envelope.js";

const VALID_KEK = randomBytes(32).toString("base64");

function withKek(kek: string | undefined, fn: () => void): void {
  const prev = process.env.KEK_MASTER;
  if (kek === undefined) delete process.env.KEK_MASTER;
  else process.env.KEK_MASTER = kek;
  __resetKekCacheForTests();
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.KEK_MASTER;
    else process.env.KEK_MASTER = prev;
    __resetKekCacheForTests();
  }
}

describe("envelope encryption", () => {
  beforeEach(() => {
    process.env.KEK_MASTER = VALID_KEK;
    __resetKekCacheForTests();
  });

  afterEach(() => {
    delete process.env.KEK_MASTER;
    __resetKekCacheForTests();
  });

  it("round-trips a plaintext string", () => {
    const plaintext = "bsky-app-password-abc123";
    const envelope = encrypt(plaintext);
    expect(decrypt(envelope)).toBe(plaintext);
  });

  it("round-trips unicode", () => {
    const plaintext = "héllo 🌸 世界";
    const envelope = encrypt(plaintext);
    expect(decrypt(envelope)).toBe(plaintext);
  });

  it("produces ciphertext that is not the plaintext", () => {
    const plaintext = "super-secret-token";
    const envelope = encrypt(plaintext);
    const ciphertextBytes = Buffer.from(envelope.ciphertext, "base64");
    expect(ciphertextBytes.toString("utf8")).not.toBe(plaintext);
    expect(envelope.ciphertext).not.toContain(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (fresh DEK + IV per call)", () => {
    const plaintext = "same-plaintext";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(a.dekCiphertext).not.toBe(b.dekCiphertext);
  });

  it("detects tampering with the ciphertext auth tag", () => {
    const envelope = encrypt("sensitive");
    const tampered = Buffer.from(envelope.authTag, "base64");
    tampered[0] = tampered[0]! ^ 0x01;
    expect(() =>
      decrypt({ ...envelope, authTag: tampered.toString("base64") }),
    ).toThrow();
  });

  it("detects tampering with the ciphertext bytes", () => {
    const envelope = encrypt("sensitive");
    const tampered = Buffer.from(envelope.ciphertext, "base64");
    tampered[0] = tampered[0]! ^ 0x01;
    expect(() =>
      decrypt({ ...envelope, ciphertext: tampered.toString("base64") }),
    ).toThrow();
  });

  it("detects tampering with the wrapped DEK blob", () => {
    const envelope = encrypt("sensitive");
    const tampered = Buffer.from(envelope.dekCiphertext, "base64");
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0x01;
    expect(() =>
      decrypt({ ...envelope, dekCiphertext: tampered.toString("base64") }),
    ).toThrow();
  });

  it("fails decrypt under a different KEK", () => {
    const envelope = encrypt("sensitive");
    const otherKek = randomBytes(32).toString("base64");
    withKek(otherKek, () => {
      expect(() => decrypt(envelope)).toThrow();
    });
  });

  it("throws a clear startup error when KEK_MASTER is missing", () => {
    withKek(undefined, () => {
      expect(() => encrypt("x")).toThrow(/KEK_MASTER/);
    });
  });

  it("throws a clear startup error when KEK_MASTER is not 32 bytes", () => {
    const shortKek = randomBytes(16).toString("base64");
    withKek(shortKek, () => {
      expect(() => encrypt("x")).toThrow(/32 bytes/);
    });
  });
});
