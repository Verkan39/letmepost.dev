import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { apiKeys } from "../db/schema/api_keys.js";
import { LetmepostError } from "../errors.js";

export type ApiKeyContext = {
  organizationId: string;
  apiKeyId: string;
  scopes: string[];
};

declare module "hono" {
  interface ContextVariableMap {
    apiKey: ApiKeyContext;
  }
}

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Validates `Authorization: Bearer lmp_live_…` / `lmp_test_…` headers. On
 * success, attaches `{ organizationId, apiKeyId, scopes }` to the request
 * context via `c.var.apiKey`. Uses `c.var.db` so the same middleware works
 * against the production singleton or a test transaction.
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "Missing or malformed Authorization header.",
        remediation:
          "Send Authorization: Bearer lmp_live_… with every request.",
      });
    }
    const presented = header.slice("Bearer ".length).trim();
    if (
      presented.length === 0 ||
      !(presented.startsWith("lmp_live_") || presented.startsWith("lmp_test_"))
    ) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "API key format is invalid.",
        remediation:
          "Expect lmp_live_… or lmp_test_… as the bearer token value.",
      });
    }

    const db = c.var.db;
    const hashed = hashKey(presented);
    const [row] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.hashedKey, hashed), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (!row) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "API key is invalid or revoked.",
        remediation:
          "Rotate the key from the dashboard. If you believe this is a mistake, contact support@letmepost.dev.",
      });
    }

    c.set("apiKey", {
      organizationId: row.organizationId,
      apiKeyId: row.id,
      scopes: row.scopes,
    });

    // Best-effort last_used_at update — don't block the request.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {});

    await next();
  };
}
