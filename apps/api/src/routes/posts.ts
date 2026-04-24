import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CreatePostRequest } from "@letmepost/schemas";
import { LetmepostError } from "../errors.js";
import { apiKeyAuth } from "../middleware/api-key.js";
import { idempotency } from "../middleware/idempotency.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { blueskyPublisher } from "../platforms/bluesky/publisher.js";
import { DrizzlePlatformAccountsRepository } from "../repositories/platform-accounts.js";

export const posts = new Hono();

posts.use("*", apiKeyAuth());
posts.use("*", rateLimit());
posts.use("*", idempotency());

posts.post(
  "/",
  zValidator("json", CreatePostRequest, (result) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Request body failed validation.",
        rule: issue?.path.join(".") || "body",
        platformResponse: result.error.issues,
        remediation: "Check the request body matches the documented schema.",
      });
    }
  }),
  async (c) => {
    const { account: accountRef, text, media } = c.req.valid("json");
    const { organizationId } = c.var.apiKey;
    const repo = new DrizzlePlatformAccountsRepository(c.var.db);

    const account = await repo.findById(accountRef.id);
    if (!account || account.organizationId !== organizationId) {
      throw new LetmepostError({
        code: "not_found",
        status: 404,
        message: "Platform account not found.",
        remediation:
          "Verify the account id and that it belongs to your organization.",
      });
    }

    if (account.platform !== accountRef.platform) {
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Platform mismatch: account is ${account.platform} but request specified ${accountRef.platform}.`,
      });
    }

    switch (account.platform) {
      case "bluesky": {
        const result = await blueskyPublisher.publish(
          { handle: account.platformAccountId, appPassword: account.token },
          {
            text,
            ...(media !== undefined ? { media } : {}),
          },
        );
        return c.json(result, 201);
      }
      default: {
        const _exhaustive: never = account.platform;
        void _exhaustive;
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          message: "Unknown platform.",
        });
      }
    }
  },
);
