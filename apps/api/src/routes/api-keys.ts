import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { apiKeys } from "../db/schema/api_keys.js";
import { profiles as profilesTable } from "../db/schema/profiles.js";
import { LetmepostError } from "../errors.js";
import { idempotency } from "../middleware/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireSession } from "../middleware/session.js";

const CreateApiKeyRequest = z.object({
  name: z.string().min(1).max(100),
  prefix: z.enum(["lmp_live_", "lmp_test_"]).default("lmp_live_"),
  scopes: z.array(z.string()).default([]),
  /**
   * Optional profile scope. When set, the key only authenticates requests
   * targeting that profile; cross-profile reads/writes 404. NULL = org-wide.
   */
  profileId: z.string().uuid().nullable().optional(),
});

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateKey(prefix: "lmp_live_" | "lmp_test_"): string {
  const secret = randomBytes(24).toString("base64url");
  return `${prefix}${secret}`;
}

export const apiKeyRoutes = new Hono();

apiKeyRoutes.use("*", requireSession());
apiKeyRoutes.use("*", rateLimit());
apiKeyRoutes.use("*", idempotency());

/** POST /v1/api-keys — creates a new org-scoped API key. Plaintext is returned once. */
apiKeyRoutes.post(
  "/",
  zValidator("json", CreateApiKeyRequest, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Invalid request body.",
        rule: issue?.path.join(".") || "body",
        platformResponse: result.error.issues,
      });
    }
  }),
  async (c) => {
    const { name, prefix, scopes, profileId } = c.req.valid("json");
    const { organizationId } = c.var.session;

    // Validate the profile scope if one was supplied — cross-org IDs would
    // otherwise create a dangling reference (the FK CASCADE would still
    // protect us from leaks, but a friendly 404 is the right surface).
    if (profileId) {
      const [profile] = await c.var.db
        .select({ organizationId: profilesTable.organizationId })
        .from(profilesTable)
        .where(eq(profilesTable.id, profileId))
        .limit(1);
      if (!profile || profile.organizationId !== organizationId) {
        throw new LetmepostError({
          code: "not_found",
          status: 404,
          message: "Profile not found.",
          rule: "profile.unknown",
        });
      }
    }

    const plaintext = generateKey(prefix);
    const last4 = plaintext.slice(-4);

    const [row] = await c.var.db
      .insert(apiKeys)
      .values({
        organizationId,
        profileId: profileId ?? null,
        name,
        prefix,
        hashedKey: hashKey(plaintext),
        last4,
        scopes,
      })
      .returning();
    if (!row) {
      throw new LetmepostError({
        code: "internal_error",
        status: 500,
        message: "Failed to create API key.",
      });
    }

    return c.json(
      {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        last4: row.last4,
        scopes: row.scopes,
        profileId: row.profileId,
        key: plaintext,
        createdAt: row.createdAt,
      },
      201,
    );
  },
);

/** GET /v1/api-keys — lists active keys for the session's active org. */
apiKeyRoutes.get("/", async (c) => {
  const { organizationId } = c.var.session;
  const rows = await c.var.db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      last4: apiKeys.last4,
      scopes: apiKeys.scopes,
      profileId: apiKeys.profileId,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, organizationId))
    .orderBy(desc(apiKeys.createdAt));

  return c.json({ data: rows });
});

/** DELETE /v1/api-keys/:id — soft-revokes an API key. */
apiKeyRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const { organizationId } = c.var.session;

  const [row] = await c.var.db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, id),
        eq(apiKeys.organizationId, organizationId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning();

  if (!row) {
    throw new LetmepostError({
      code: "validation_failed",
      status: 404,
      message: "API key not found or already revoked.",
    });
  }

  return c.json({ id: row.id, revokedAt: row.revokedAt });
});
