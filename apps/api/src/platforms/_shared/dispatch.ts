import type { CreatePostResponse } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import type { DecryptedPlatformAccount } from "../../repositories/platform-accounts.js";
import { blueskyPublisher } from "../bluesky/publisher.js";
import { linkedinPublisher } from "../linkedin/publisher.js";
import { pinterestPublisher } from "../pinterest/publisher.js";
import { twitterPublisher } from "../twitter/publisher.js";

/**
 * Single source of truth for "given an account + a post body, run the right
 * publisher". Both the synchronous /v1/posts handler and the scheduled-post
 * worker route through here, which means adding a platform is one switch
 * case in this file — not two parallel edits.
 *
 * Per-platform input shapes are *load-bearing on types* (Pinterest needs
 * boardId/destinationUrl/imageUrl, Bluesky cares about firstComment, etc.),
 * so the dispatch is hand-rolled — a registry-callback abstraction would
 * either erase the type info or require a discriminated union per platform.
 * The hand-rolled switch is honest about what differs.
 *
 * Pinterest MVP carve-out: per-post boardId/destinationUrl/imageUrl ride on
 * `tokenMetadata` until the Phase 11 follow-up moves them into the request
 * body. Documented + asserted up front so nobody adds a third copy.
 */

export type PublishInput = {
  text: string;
  media?: Parameters<typeof blueskyPublisher.publish>[1]["media"];
  firstComment?: Parameters<typeof blueskyPublisher.publish>[1]["firstComment"];
};

export async function publishForAccount(
  account: DecryptedPlatformAccount,
  input: PublishInput,
): Promise<CreatePostResponse> {
  switch (account.platform) {
    case "bluesky": {
      const blueskyInput: Parameters<typeof blueskyPublisher.publish>[1] = {
        text: input.text,
      };
      if (input.media !== undefined) blueskyInput.media = input.media;
      if (input.firstComment !== undefined) {
        blueskyInput.firstComment = input.firstComment;
      }
      return blueskyPublisher.publish(
        { handle: account.platformAccountId, appPassword: account.token },
        blueskyInput,
      );
    }
    case "linkedin": {
      const meta = (account.tokenMetadata ?? {}) as Record<string, unknown>;
      const authorUrn =
        typeof meta.authorUrn === "string" && meta.authorUrn.length > 0
          ? meta.authorUrn
          : `urn:li:person:${account.platformAccountId}`;
      return linkedinPublisher.publish(
        { accessToken: account.token, authorUrn },
        { text: input.text, authorUrn },
      );
    }
    case "twitter":
      return twitterPublisher.publish(
        {
          accessToken: account.token,
          userId: account.platformAccountId,
        },
        {
          text: input.text,
          ...(input.media !== undefined ? { media: input.media } : {}),
        },
      );
    case "pinterest": {
      const meta = (account.tokenMetadata ?? {}) as Record<string, unknown>;
      const boardId = pickString(meta.boardId) ?? pickString(meta.board_id);
      const destinationUrl =
        pickString(meta.destinationUrl) ?? pickString(meta.destination_url);
      const imageUrl =
        pickString(meta.imageUrl) ?? pickString(meta.image_url);
      if (!boardId || !destinationUrl || !imageUrl) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          platform: "pinterest",
          message:
            "Pinterest posts need boardId, destinationUrl, and imageUrl set on the account metadata (MVP).",
          rule: "pinterest.account_metadata.required",
          remediation:
            "Populate boardId/destinationUrl/imageUrl on platformAccount.tokenMetadata, or wait for the Phase 11 per-post media slice.",
        });
      }
      return pinterestPublisher.publish(
        { accessToken: account.token },
        {
          boardId,
          destinationUrl,
          imageUrl,
          ...(input.text !== undefined ? { text: input.text } : {}),
        },
      );
    }
    default:
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Unknown platform: ${account.platform}.`,
      });
  }
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
