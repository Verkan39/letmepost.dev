import type { CreatePostResponse, MediaInput } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
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

/**
 * A media item with bytes + mime type resolved, ready for preflight + upload.
 */
interface LoadedMediaItem extends ResolvedMediaItem {
  bytes: Uint8Array;
}

async function loadMediaItem(item: MediaInput): Promise<LoadedMediaItem> {
  let bytes: Uint8Array;
  let mimeType: string;

  if (item.bytesBase64) {
    bytes = Uint8Array.from(Buffer.from(item.bytesBase64, "base64"));
    mimeType = item.kind === "image" ? "image/jpeg" : "video/mp4";
  } else if (item.url) {
    let res: Response;
    try {
      res = await fetch(item.url);
    } catch {
      throw new LetmepostError({
        code: "platform_unavailable",
        status: 503,
        message: `Failed to fetch media from ${item.url}.`,
        remediation:
          "Verify the media URL is publicly reachable. letmepost fetches synchronously in Phase 3.5.",
      });
    }
    if (!res.ok) {
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: `Media URL returned ${res.status}: ${item.url}`,
        remediation:
          "Ensure the URL is public and returns 200. Consider inlining bytesBase64 for authenticated sources.",
      });
    }
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
    const contentType = res.headers.get("content-type");
    if (contentType && contentType.length > 0) {
      // Strip parameters (e.g. "image/jpeg; charset=binary").
      mimeType = contentType.split(";")[0]!.trim().toLowerCase();
    } else {
      mimeType = item.kind === "image" ? "image/jpeg" : "video/mp4";
    }
  } else {
    // Zod refinement should prevent this, but keep a loud fallback.
    throw new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: "Media item must provide either 'url' or 'bytesBase64'.",
    });
  }

  const resolved: LoadedMediaItem = {
    kind: item.kind,
    mimeType,
    byteLength: bytes.byteLength,
    bytes,
  };
  if (item.altText !== undefined) resolved.altText = item.altText;
  return resolved;
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
