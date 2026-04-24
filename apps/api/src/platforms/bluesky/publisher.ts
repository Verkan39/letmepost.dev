import type { CreatePostResponse, MediaInput } from "@letmepost/schemas";
import {
  loadMediaItem as sharedLoadMediaItem,
  type LoadedMediaItem as SharedLoadedMediaItem,
} from "../_shared/media.js";
import type { Publisher } from "../_shared/publisher.js";
import {
  BlueskyClient,
  type BlueskyBlobRef,
  type BlueskyEmbed,
  type BlueskyPostResult,
  type BlueskySession,
} from "./client.js";
import {
  type ResolvedMediaItem,
  validateBlueskyFirstComment,
  validateBlueskyMedia,
  validateBlueskyText,
} from "./preflight.js";

/**
 * Credentials the Bluesky publisher needs to authenticate + post. Callers
 * resolve these from a stored platform_account via the repository — the
 * publisher never touches the DB directly.
 */
export type BlueskyCredentials = {
  /** Bluesky handle or email used at createSession time. */
  handle: string;
  /** Decrypted app password. */
  appPassword: string;
};

export type BlueskyPublishInput = {
  text: string;
  media?: MediaInput[];
  firstComment?: { text: string };
};

/** A media item with bytes resolved, ready for preflight + upload. */
type LoadedMediaItem = SharedLoadedMediaItem;

function loadMediaItem(item: MediaInput): Promise<LoadedMediaItem> {
  return sharedLoadMediaItem(item, {
    platform: "bluesky",
    reachableRule: "bluesky.media.reachable",
  });
}

function buildEmbed(
  items: LoadedMediaItem[],
  blobRefs: BlueskyBlobRef[],
): BlueskyEmbed | undefined {
  if (items.length === 0) return undefined;
  // Invariant enforced by preflight: all-image OR single-video, never mixed.
  if (items[0]!.kind === "video") {
    return {
      $type: "app.bsky.embed.video",
      video: blobRefs[0]!,
      alt: items[0]!.altText ?? "",
    };
  }
  return {
    $type: "app.bsky.embed.images",
    images: items.map((item, i) => ({
      image: blobRefs[i]!,
      alt: item.altText ?? "",
    })),
  };
}

async function publishFirstComment(
  client: BlueskyClient,
  session: BlueskySession,
  text: string,
  mainPost: BlueskyPostResult,
): Promise<BlueskyPostResult> {
  validateBlueskyFirstComment(text);
  return client.createPost(session, {
    text,
    reply: {
      root: { uri: mainPost.uri, cid: mainPost.cid },
      parent: { uri: mainPost.uri, cid: mainPost.cid },
    },
  });
}

export const blueskyPublisher: Publisher<BlueskyCredentials, BlueskyPublishInput> = {
  async publish(creds, input): Promise<CreatePostResponse> {
    const { text, media = [], firstComment } = input;

    validateBlueskyText(text);

    // Resolve bytes FIRST (so size preflight is honest), then preflight, then
    // upload. If any resolve/preflight step fails, we never hit upstream.
    const loaded = await Promise.all(media.map(loadMediaItem));
    validateBlueskyMedia(
      loaded.map((l) => {
        const item: ResolvedMediaItem = {
          kind: l.kind,
          mimeType: l.mimeType,
          byteLength: l.byteLength,
        };
        if (l.altText !== undefined) item.altText = l.altText;
        return item;
      }),
    );

    // firstComment preflight is cheap + doesn't need the session; run it early
    // so a bad comment fails before we spend upstream calls on the main post.
    if (firstComment) validateBlueskyFirstComment(firstComment.text);

    const client = new BlueskyClient(creds.handle, creds.appPassword);
    const session = await client.createSession();

    const blobRefs: BlueskyBlobRef[] = [];
    for (const item of loaded) {
      const ref = await client.uploadBlob(session, item.bytes, item.mimeType);
      blobRefs.push(ref);
    }

    const embed = buildEmbed(loaded, blobRefs);

    const mainInput: Parameters<BlueskyClient["createPost"]>[1] = embed
      ? { text, embed }
      : { text };
    const main = await client.createPost(session, mainInput);

    const response: CreatePostResponse = {
      id: main.cid,
      platform: "bluesky",
      uri: main.uri,
      cid: main.cid,
      createdAt: new Date().toISOString(),
    };

    // First-comment semantics: if the main post succeeded but the reply fails,
    // we DO NOT roll back or error out. The user's content is live; we surface
    // the failure as a warning so callers can retry the reply independently.
    // Rationale: undoing a successful publish on a distributed PDS is racy and
    // surprising; losing the first comment is a recoverable failure.
    if (firstComment) {
      try {
        const reply = await publishFirstComment(
          client,
          session,
          firstComment.text,
          main,
        );
        response.firstCommentUri = reply.uri;
        response.firstCommentCid = reply.cid;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "First-comment publish failed.";
        response.warnings = [
          ...(response.warnings ?? []),
          {
            code: "first_comment_failed",
            message,
          },
        ];
      }
    }

    return response;
  },
};
