import { describe, expect, it } from "vitest";
import { signHmac, verifyHmac } from "../src/webhooks/sign.js";

describe("webhook HMAC sign/verify", () => {
  const secret = "whsec_deadbeefdeadbeefdeadbeef";
  const body = JSON.stringify({ id: "evt_1", type: "post.published", data: {} });

  it("signHmac returns a sha256= prefixed hex digest", () => {
    const sig = signHmac(secret, body);
    expect(sig.startsWith("sha256=")).toBe(true);
    // 64 hex chars + prefix
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verifyHmac accepts a matching signature (happy path)", () => {
    const sig = signHmac(secret, body);
    expect(verifyHmac(secret, body, sig)).toBe(true);
  });

  it("verifyHmac accepts bare-hex signatures too (prefix is optional)", () => {
    const sig = signHmac(secret, body).replace("sha256=", "");
    expect(verifyHmac(secret, body, sig)).toBe(true);
  });

  it("verifyHmac rejects a tampered body", () => {
    const sig = signHmac(secret, body);
    const tampered = body.replace("post.published", "post.failed");
    expect(verifyHmac(secret, tampered, sig)).toBe(false);
  });

  it("verifyHmac rejects a tampered signature", () => {
    const sig = signHmac(secret, body);
    // Flip the last hex char.
    const lastChar = sig.at(-1)!;
    const flipped = sig.slice(0, -1) + (lastChar === "0" ? "1" : "0");
    expect(verifyHmac(secret, body, flipped)).toBe(false);
  });

  it("verifyHmac rejects signatures produced with the wrong secret", () => {
    const sig = signHmac(secret, body);
    expect(verifyHmac("whsec_wrong_secret", body, sig)).toBe(false);
  });

  it("verifyHmac rejects empty / malformed signatures without throwing", () => {
    expect(verifyHmac(secret, body, "")).toBe(false);
    expect(verifyHmac(secret, body, "sha256=")).toBe(false);
    expect(verifyHmac(secret, body, "not-a-signature")).toBe(false);
  });

  it("verifyHmac uses a constant-time comparison (byte length matches)", () => {
    const sig = signHmac(secret, body);
    // Signature of same length but all zeros → must still return false
    // without throwing. This exercises the timing-safe buffer equality path.
    const sameLengthGarbage = `sha256=${"0".repeat(64)}`;
    expect(sameLengthGarbage.length).toBe(sig.length);
    expect(verifyHmac(secret, body, sameLengthGarbage)).toBe(false);
  });
});
