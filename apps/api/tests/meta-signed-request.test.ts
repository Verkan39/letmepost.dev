import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMetaSignedRequest } from "../src/webhooks/meta-signed-request.js";

const SECRET = "fb_app_secret_test_value";

function base64Url(buf: Buffer | string): string {
  return (typeof buf === "string" ? Buffer.from(buf, "utf8") : buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeSignedRequest(
  payload: Record<string, unknown>,
  secret = SECRET,
): string {
  const encodedPayload = base64Url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(encodedPayload).digest();
  return `${base64Url(sig)}.${encodedPayload}`;
}

describe("parseMetaSignedRequest", () => {
  const validPayload = {
    algorithm: "HMAC-SHA256",
    user_id: "1234567890",
    issued_at: 1746000000,
  };

  it("accepts a well-formed signed_request and returns the payload", () => {
    const sr = makeSignedRequest(validPayload);
    const result = parseMetaSignedRequest(sr, SECRET);
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe("1234567890");
    expect(result?.algorithm).toBe("HMAC-SHA256");
  });

  it("rejects a request signed with the wrong secret", () => {
    const sr = makeSignedRequest(validPayload, "wrong_secret");
    expect(parseMetaSignedRequest(sr, SECRET)).toBeNull();
  });

  it("rejects a payload with the wrong algorithm", () => {
    const sr = makeSignedRequest({
      ...validPayload,
      algorithm: "HMAC-SHA1",
    });
    expect(parseMetaSignedRequest(sr, SECRET)).toBeNull();
  });

  it("rejects a payload missing user_id", () => {
    const sr = makeSignedRequest({ algorithm: "HMAC-SHA256" });
    expect(parseMetaSignedRequest(sr, SECRET)).toBeNull();
  });

  it("rejects a payload with an empty user_id", () => {
    const sr = makeSignedRequest({
      algorithm: "HMAC-SHA256",
      user_id: "",
    });
    expect(parseMetaSignedRequest(sr, SECRET)).toBeNull();
  });

  it("rejects malformed inputs without throwing", () => {
    expect(parseMetaSignedRequest("", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("nodot", SECRET)).toBeNull();
    expect(parseMetaSignedRequest(".", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("a.b.c", SECRET)).toBeNull();
    expect(parseMetaSignedRequest("not-base64.{}", SECRET)).toBeNull();
  });

  it("rejects when payload bytes don't decode to JSON", () => {
    const encodedSig = base64Url(
      createHmac("sha256", SECRET).update("not-json").digest(),
    );
    const sr = `${encodedSig}.${base64Url("not-json")}`;
    expect(parseMetaSignedRequest(sr, SECRET)).toBeNull();
  });

  it("rejects an empty app secret", () => {
    const sr = makeSignedRequest(validPayload);
    expect(parseMetaSignedRequest(sr, "")).toBeNull();
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const sr = makeSignedRequest(validPayload);
    // Replace the encoded payload with a different one — sig won't match.
    const [sig] = sr.split(".");
    const tampered = `${sig}.${base64Url(
      JSON.stringify({ ...validPayload, user_id: "9999" }),
    )}`;
    expect(parseMetaSignedRequest(tampered, SECRET)).toBeNull();
  });
});
