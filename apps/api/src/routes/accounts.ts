import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Platform } from "@letmepost/schemas";
import { profiles as profilesTable } from "../db/schema/profiles.js";
import { LetmepostError } from "../errors.js";
import { idempotency } from "../middleware/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireSession } from "../middleware/session.js";
import { getProvider } from "../platforms/index.js";
import { computeRefreshDelayMs } from "../platforms/_shared/refresh.js";
import { DrizzlePlatformAccountsRepository } from "../repositories/platform-accounts.js";
import { DrizzleProfilesRepository } from "../repositories/profiles.js";

/**
 * `/v1/accounts` — connected social media accounts for the session's active
 * org. The wedge of Phase 5 is that `connect` / `complete` are generic across
 * platforms: each provider implements the `AccountProvider` contract and the
 * router just dispatches.
 *
 * Shape:
 *   POST /v1/accounts/connect/:platform           → returns a ConnectDescriptor
 *                                                     (OAuth URL for OAuth platforms,
 *                                                      form schema for Bluesky)
 *   POST /v1/accounts/connect/:platform/complete  → finishes the handshake;
 *                                                     upserts platform_accounts
 *   GET  /v1/accounts                             → list (no secrets)
 *   GET  /v1/accounts/:id                         → detail (no secrets)
 *   DELETE /v1/accounts/:id                       → hard delete
 *
 * Secrets are NEVER returned from any endpoint — only the display name,
 * platform, platformAccountId, and lifecycle timestamps leak out.
 */

const PlatformParam = z.object({ platform: Platform });

function publicView(account: {
  id: string;
  profileId: string;
  platform: string;
  platformAccountId: string;
  displayName: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: account.id,
    profileId: account.profileId,
    platform: account.platform,
    platformAccountId: account.platformAccountId,
    displayName: account.displayName,
    tokenExpiresAt: account.tokenExpiresAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export type AccountRoutesOptions = {
  /** Test-only session middleware override (matches webhook-endpoints pattern). */
  sessionMiddleware?: MiddlewareHandler;
  /**
   * Public base URL used by providers to build OAuth redirect URIs. Defaults
   * to `PUBLIC_API_BASE_URL` env or `http://localhost:3000` for local dev.
   */
  baseUrl?: string;
  /**
   * Override for the refresh-token queue enqueuer. Tests pass a capturing
   * stub to assert the initial scheduled refresh was queued with the right
   * delay; production uses the BullMQ-backed default (lazily imported so
   * this route module doesn't open a Redis connection at import time).
   */
  refreshEnqueuer?: import("../queue/refresh-enqueue.js").TokenRefreshEnqueuer;
};

export function createAccountRoutes(options: AccountRoutesOptions = {}) {
  const app = new Hono();
  app.use("*", options.sessionMiddleware ?? requireSession());
  app.use("*", rateLimit());
  app.use("*", idempotency());

  const baseUrl =
    options.baseUrl ??
    process.env.PUBLIC_API_BASE_URL ??
    "http://localhost:3000";

  async function scheduleInitialRefresh(params: {
    accountId: string;
    organizationId: string;
    horizonMs: number;
    tokenExpiresAt: Date | null;
  }): Promise<void> {
    const delay = computeRefreshDelayMs(
      { tokenExpiresAt: params.tokenExpiresAt },
      params.horizonMs,
    );
    if (delay === null) return;
    const enqueuer =
      options.refreshEnqueuer ??
      (await import("../queue/refresh-enqueue.js")).createDefaultTokenRefreshEnqueuer();
    await enqueuer
      .enqueue(
        {
          platformAccountId: params.accountId,
          organizationId: params.organizationId,
        },
        { delayMs: delay },
      )
      .catch((err: unknown) => {
        // A failed refresh schedule shouldn't break the connect flow — the
        // account is saved; worst case we re-auth lazily on next publish.
        console.error("[accounts] refresh schedule failed", err);
      });
  }

  /** POST /v1/accounts/connect/:platform — describe how to connect. */
  app.post(
    "/connect/:platform",
    zValidator("param", PlatformParam, (result) => {
      if (!result.success) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: "Unknown platform.",
          rule: "platform",
          platformResponse: result.error.issues,
        });
      }
    }),
    async (c) => {
      const { platform } = c.req.valid("param");
      const provider = getProvider(platform);
      const { organizationId } = c.var.session;

      const descriptor = await provider.describeConnect({ organizationId, baseUrl });
      return c.json({ platform, descriptor });
    },
  );

  /** POST /v1/accounts/connect/:platform/complete — finish the connect. */
  app.post(
    "/connect/:platform/complete",
    zValidator("param", PlatformParam, (result) => {
      if (!result.success) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: "Unknown platform.",
          rule: "platform",
          platformResponse: result.error.issues,
        });
      }
    }),
    async (c) => {
      const { platform } = c.req.valid("param");
      const provider = getProvider(platform);
      const { organizationId } = c.var.session;

      const body = (await c.req.json().catch(() => ({}))) as
        | { profileId?: unknown }
        | undefined;
      const requestedProfileId =
        body && typeof body.profileId === "string" ? body.profileId : null;

      const profileId = await resolveProfileId(c.var.db, organizationId, requestedProfileId);

      const connected = await provider.completeConnect(
        { organizationId, baseUrl },
        body,
      );

      const repo = new DrizzlePlatformAccountsRepository(c.var.db);
      const existing = await repo.findByOrgAndPlatform(
        organizationId,
        platform,
        connected.platformAccountId,
      );

      // Upsert semantics: re-connecting the same account rotates the stored
      // token and metadata rather than creating a duplicate row. The UNIQUE
      // index on (org, platform, platformAccountId) would otherwise 409.
      if (existing) {
        const updated = await repo.updateToken(existing.id, {
          token: connected.token,
          tokenMetadata: connected.tokenMetadata,
          tokenExpiresAt: connected.tokenExpiresAt,
        });
        await scheduleInitialRefresh({
          accountId: updated.id,
          organizationId,
          horizonMs: provider.expiringHorizonMs,
          tokenExpiresAt: updated.tokenExpiresAt,
        });
        return c.json(publicView(updated));
      }

      const created = await repo.create({
        organizationId,
        profileId,
        platform,
        platformAccountId: connected.platformAccountId,
        displayName: connected.displayName,
        token: connected.token,
        tokenMetadata: connected.tokenMetadata,
        tokenExpiresAt: connected.tokenExpiresAt,
      });
      await scheduleInitialRefresh({
        accountId: created.id,
        organizationId,
        horizonMs: provider.expiringHorizonMs,
        tokenExpiresAt: created.tokenExpiresAt,
      });
      return c.json(publicView(created), 201);
    },
  );

  /** GET /v1/accounts — list for the session's active org. */
  app.get("/", async (c) => {
    const { organizationId } = c.var.session;
    const repo = new DrizzlePlatformAccountsRepository(c.var.db);
    const rows = await repo.listByOrg(organizationId);
    return c.json({ data: rows.map(publicView) });
  });

  /** GET /v1/accounts/:id — detail (no secret). */
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;
    const repo = new DrizzlePlatformAccountsRepository(c.var.db);
    const account = await repo.findById(id);
    if (!account || account.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Platform account not found.",
      });
    }
    return c.json(publicView(account));
  });

  /** DELETE /v1/accounts/:id — hard delete. */
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;
    const repo = new DrizzlePlatformAccountsRepository(c.var.db);

    const account = await repo.findById(id);
    if (!account || account.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Platform account not found.",
      });
    }

    const deleted = await repo.delete(id);
    if (!deleted) {
      throw new LetmepostError({
        code: "internal_error",
        status: 500,
        message: "Failed to delete platform account.",
      });
    }

    return c.json({ id, deleted: true });
  });

  return app;
}

/**
 * Resolve the profile a connect/complete should land in.
 *
 *  - If the caller supplied a `profileId` in the body, verify it belongs to
 *    the same org and use it.
 *  - Otherwise, fall back to the org's "Default" profile (slug=`default`),
 *    which sign-up creates automatically.
 *
 * Throws `validation_failed` (400) for cross-org IDs, `not_found` (404) for
 * unknown IDs, and `internal_error` (500) if the org has no Default profile
 * (shouldn't happen — sign-up creates it; the migration backfilled it).
 */
async function resolveProfileId(
  db: import("../db/index.js").DrizzleClient,
  organizationId: string,
  requestedProfileId: string | null,
): Promise<string> {
  if (requestedProfileId) {
    const [row] = await db
      .select({ id: profilesTable.id, organizationId: profilesTable.organizationId })
      .from(profilesTable)
      .where(eq(profilesTable.id, requestedProfileId))
      .limit(1);
    if (!row) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Profile not found.",
        rule: "profile.unknown",
      });
    }
    if (row.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Profile not found.",
        rule: "profile.cross_org",
      });
    }
    return row.id;
  }

  const repo = new DrizzleProfilesRepository(db);
  const def = await repo.findByOrgAndSlug(organizationId, "default");
  if (def) return def.id;

  // No Default profile — auto-create one. This shouldn't trigger after the
  // migration backfill, but it makes the connect flow resilient for orgs
  // created via paths that don't seed a Default (e.g. tests that build an
  // org by hand).
  const created = await repo.create({
    organizationId,
    name: "Default",
    slug: "default",
  });
  return created.id;
}

export const accountRoutes = createAccountRoutes();
