import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CreatePostRequest } from "@letmepost/schemas";
import { publishToBluesky } from "../platforms/bluesky/publisher.js";
import { LetmepostError } from "../errors.js";

export const posts = new Hono();

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
    const { account, text } = c.req.valid("json");
    switch (account.platform) {
      case "bluesky": {
        const result = await publishToBluesky(account, text);
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
