import { Hono, type MiddlewareHandler } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { LetmepostError } from "../errors.js";
import { idempotency } from "../middleware/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireSession } from "../middleware/session.js";
import {
  DrizzleProfilesRepository,
  ProfileNotEmptyError,
  slugify,
} from "../repositories/profiles.js";

/**
 * `/v1/profiles` — org sub-units that group platform accounts. Session-scoped
 * (dashboard surface). Org-isolated: every read/write filters by the active
 * org from `c.var.session`.
 *
 * Slug uniqueness is enforced by the DB via the unique (org, slug) index;
 * the route returns a friendly 409 if the caller tries to reuse a slug.
 */

const CreateProfileRequest = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens")
    .optional(),
});

const UpdateProfileRequest = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens")
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

function publicView(profile: {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export type ProfileRoutesOptions = {
  sessionMiddleware?: MiddlewareHandler;
};

export function createProfileRoutes(options: ProfileRoutesOptions = {}) {
  const app = new Hono();
  app.use("*", options.sessionMiddleware ?? requireSession());
  app.use("*", rateLimit());
  app.use("*", idempotency());

  /** POST /v1/profiles — create a new profile in the active org. */
  app.post(
    "/",
    zValidator("json", CreateProfileRequest, (result) => {
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
      const { name, slug: explicitSlug } = c.req.valid("json");
      const { organizationId } = c.var.session;
      const repo = new DrizzleProfilesRepository(c.var.db);

      const slug = explicitSlug ?? slugify(name);

      // Friendly conflict surface — the unique index would 500 with a
      // pg-error otherwise.
      const existing = await repo.findByOrgAndSlug(organizationId, slug);
      if (existing) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 409,
          message: `Profile slug "${slug}" already exists in this organization.`,
          rule: "profile.slug.unique",
          remediation: "Pick a different slug or rename the existing profile.",
        });
      }

      const profile = await repo.create({ organizationId, name, slug });
      return c.json(publicView(profile), 201);
    },
  );

  /** GET /v1/profiles — list profiles in the active org. */
  app.get("/", async (c) => {
    const { organizationId } = c.var.session;
    const repo = new DrizzleProfilesRepository(c.var.db);
    const rows = await repo.listByOrg(organizationId);
    return c.json({ data: rows.map(publicView) });
  });

  /** GET /v1/profiles/:id — detail. 404 on cross-org access. */
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;
    const repo = new DrizzleProfilesRepository(c.var.db);
    const profile = await repo.findById(id);
    if (!profile || profile.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Profile not found.",
      });
    }
    return c.json(publicView(profile));
  });

  /** PATCH /v1/profiles/:id — rename or re-slug. */
  app.patch(
    "/:id",
    zValidator("json", UpdateProfileRequest, (result) => {
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
      const id = c.req.param("id");
      const { organizationId } = c.var.session;
      const repo = new DrizzleProfilesRepository(c.var.db);

      const existing = await repo.findById(id);
      if (!existing || existing.organizationId !== organizationId) {
        throw new LetmepostError({
          code: "not_found",
          status: 404,
          message: "Profile not found.",
        });
      }

      const patch = c.req.valid("json");
      if (patch.slug && patch.slug !== existing.slug) {
        const dupe = await repo.findByOrgAndSlug(organizationId, patch.slug);
        if (dupe && dupe.id !== id) {
          throw new LetmepostError({
            code: "validation_failed",
            status: 409,
            message: `Profile slug "${patch.slug}" already exists in this organization.`,
            rule: "profile.slug.unique",
          });
        }
      }

      const update: Parameters<typeof repo.update>[1] = {};
      if (patch.name !== undefined) update.name = patch.name;
      if (patch.slug !== undefined) update.slug = patch.slug;
      const updated = await repo.update(id, update);
      return c.json(publicView(updated));
    },
  );

  /** DELETE /v1/profiles/:id — refuse if any platform_accounts still attach. */
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const { organizationId } = c.var.session;
    const repo = new DrizzleProfilesRepository(c.var.db);

    const existing = await repo.findById(id);
    if (!existing || existing.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Profile not found.",
      });
    }

    try {
      const ok = await repo.delete(id);
      if (!ok) {
        throw new LetmepostError({
          code: "internal_error",
          status: 500,
          message: "Failed to delete profile.",
        });
      }
    } catch (err) {
      if (err instanceof ProfileNotEmptyError) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 409,
          message: `Profile still owns ${err.accountCount} platform account(s).`,
          rule: "profile.delete.not_empty",
          remediation:
            "Disconnect or move every platform account out of this profile first.",
        });
      }
      throw err;
    }

    return c.json({ id, deleted: true });
  });

  return app;
}

export const profileRoutes = createProfileRoutes();
