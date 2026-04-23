import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedEnvelope = {
  /** Base64-encoded ciphertext of the plaintext token, encrypted with a fresh DEK. */
  ciphertext: string;
  /** Base64-encoded blob: (12-byte iv)(16-byte authTag)(wrapped DEK), where the DEK was wrapped by the KEK. */
  dekCiphertext: string;
  /** Base64-encoded IV used to encrypt the plaintext with the DEK. */
  iv: string;
  /** Base64-encoded GCM auth tag for the plaintext ciphertext. */
  authTag: string;
};

let cachedKek: Buffer | null = null;

function loadKek(): Buffer {
  if (cachedKek) return cachedKek;
  const raw = process.env.KEK_MASTER;
  if (!raw || raw.length === 0) {
    throw new Error(
      "KEK_MASTER env var is not set. Generate one with `openssl rand -base64 32` and add it to apps/api/.env (see apps/api/.env.example).",
    );
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      "KEK_MASTER could not be base64-decoded. Generate one with `openssl rand -base64 32`.",
    );
  }
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `KEK_MASTER must decode to exactly ${KEY_BYTES} bytes (got ${decoded.length}). Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  cachedKek = decoded;
  return cachedKek;
}

/**
 * For tests only. Clears the cached KEK so the next call re-reads process.env.KEK_MASTER.
 */
export function __resetKekCacheForTests(): void {
  cachedKek = null;
}

export function encrypt(plaintext: string): EncryptedEnvelope {
  const kek = loadKek();
  const dek = randomBytes(KEY_BYTES);

  const tokenIv = randomBytes(IV_BYTES);
  const tokenCipher = createCipheriv(ALGORITHM, dek, tokenIv);
  const tokenCiphertext = Buffer.concat([
    tokenCipher.update(plaintext, "utf8"),
    tokenCipher.final(),
  ]);
  const tokenAuthTag = tokenCipher.getAuthTag();

  const dekIv = randomBytes(IV_BYTES);
  const dekCipher = createCipheriv(ALGORITHM, kek, dekIv);
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  return {
    ciphertext: tokenCiphertext.toString("base64"),
    dekCiphertext: Buffer.concat([dekIv, dekAuthTag, wrappedDek]).toString(
      "base64",
    ),
    iv: tokenIv.toString("base64"),
    authTag: tokenAuthTag.toString("base64"),
  };
}

export function decrypt(envelope: EncryptedEnvelope): string {
  const kek = loadKek();

  const dekBlob = Buffer.from(envelope.dekCiphertext, "base64");
  if (dekBlob.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
    throw new Error("dekCiphertext is too short to contain IV, auth tag, and wrapped DEK");
  }
  const dekIv = dekBlob.subarray(0, IV_BYTES);
  const dekAuthTag = dekBlob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const wrappedDek = dekBlob.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const dekDecipher = createDecipheriv(ALGORITHM, kek, dekIv);
  dekDecipher.setAuthTag(dekAuthTag);
  const dek = Buffer.concat([dekDecipher.update(wrappedDek), dekDecipher.final()]);

  const tokenIv = Buffer.from(envelope.iv, "base64");
  const tokenAuthTag = Buffer.from(envelope.authTag, "base64");
  const tokenCiphertext = Buffer.from(envelope.ciphertext, "base64");

  const tokenDecipher = createDecipheriv(ALGORITHM, dek, tokenIv);
  tokenDecipher.setAuthTag(tokenAuthTag);
  const plaintext = Buffer.concat([
    tokenDecipher.update(tokenCiphertext),
    tokenDecipher.final(),
  ]);
  return plaintext.toString("utf8");
}
