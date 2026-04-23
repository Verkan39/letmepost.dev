import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Account, CreatePostResponse } from "@letmepost/schemas";
import { CreatePostRequest } from "@letmepost/schemas";
import { LetmepostError } from "../errors.js";
import { blueskyPublisher } from "../platforms/bluesky/publisher.js";

async function dispatch(account: Account, text: string): Promise<CreatePostResponse> {
  switch (account.platform) {
    case "bluesky":
      return blueskyPublisher.publish(account, text);
    default: {
      const _exhaustive: never = account.platform;
      void _exhaustive;
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Unknown platform: ${String((account as { platform: string }).platform)}.`,
      });
    }
  }
}

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
    const result = await dispatch(account, text);
    return c.json(result, 201);
  },
);
