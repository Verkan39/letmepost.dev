import type {
  CreatePostResponse,
  PinterestPostOverrides,
} from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import type { DecryptedPlatformAccount } from "../../repositories/platform-accounts.js";
import { blueskyPublisher } from "../bluesky/publisher.js";
import { linkedinPublisher } from "../linkedin/publisher.js";
import { PinterestClient } from "../pinterest/client.js";
import { pinterestPublisher } from "../pinterest/publisher.js";
import type { PinterestTokenMetadata } from "../pinterest/provider.js";
import { twitterPublisher } from "../twitter/publisher.js";
import type { MediaResolverContext } from "./media.js";

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
  /**
   * Tenancy context for resolving `mediaId`-shaped inputs. Required when any
   * media item references a mediaId; URL / bytesBase64 paths ignore it.
   */
  mediaContext?: MediaResolverContext;
  /** Pinterest-specific per-post overrides (board, destination URL, title). */
  pinterest?: PinterestPostOverrides;
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
      if (input.mediaContext !== undefined) {
        blueskyInput.mediaContext = input.mediaContext;
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
          ...(input.mediaContext !== undefined
            ? { mediaContext: input.mediaContext }
            : {}),
        },
      );
    case "pinterest": {
      const meta = (account.tokenMetadata ?? {}) as PinterestTokenMetadata;
      const boardId = input.pinterest?.boardId ?? meta.defaultBoardId;
      if (!boardId) {
        // Best-effort: surface the user's actual boards so the caller can
        // pick one without an extra round-trip. Already on the failure
        // path, so the extra Pinterest call is acceptable; if it fails
        // we just omit the hint rather than masking the real error.
        let availableBoards: { id: string; name: string }[] | undefined;
        try {
          const client = new PinterestClient(account.token);
          const boards = await client.listBoards({ pageSize: 25 });
          availableBoards = boards.map((b) => ({ id: b.id, name: b.name }));
        } catch {
          // intentional swallow — the publish error is what matters
        }
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          platform: "pinterest",
          message:
            "Pinterest posts need a board — none configured on the account and none on the request.",
          rule: "pinterest.board.required",
          remediation:
            "Set a default board via PATCH /v1/accounts/:id/pinterest/default-board, or pass `pinterest: { boardId }` on the request body. Use one of the ids in `platformResponse.availableBoards` below.",
          ...(availableBoards
            ? { platformResponse: { availableBoards } }
            : {}),
        });
      }
      if (!input.media || input.media.length === 0) {
        throw new LetmepostError({
          code: "validation_failed",
          status: 400,
          platform: "pinterest",
          message: "Pinterest posts require a media item.",
          rule: "pinterest.media.required",
          remediation:
            "Pass `media: [{ kind: \"image\", url | mediaId }]` on the request body.",
        });
      }
      return pinterestPublisher.publish(
        { accessToken: account.token },
        {
          boardId,
          media: input.media,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.pinterest?.destinationUrl !== undefined
            ? { destinationUrl: input.pinterest.destinationUrl }
            : {}),
          ...(input.pinterest?.title !== undefined
            ? { title: input.pinterest.title }
            : {}),
          ...(input.mediaContext !== undefined
            ? { mediaContext: input.mediaContext }
            : {}),
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
