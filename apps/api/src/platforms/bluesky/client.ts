import { platformFetch } from "../_shared/http.js";
import { authFailed, extractUpstreamMessage, rejected } from "../_shared/errors.js";

const DEFAULT_PDS = "https://bsky.social";
const PLATFORM = "bluesky";

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

/**
 * AT Proto blob descriptor returned by `com.atproto.repo.uploadBlob` and
 * subsequently embedded inside a record's `embed` field.
 * See: https://atproto.com/specs/data-model#blob-type
 */
export interface BlueskyBlobRef {
  $type: "blob";
  ref: { $link: string } | string;
  mimeType: string;
  size: number;
}

export interface BlueskyUploadBlobResponse {
  blob: BlueskyBlobRef;
}

/**
 * Discriminated union of record-level `embed` values we support today. The
 * AT Proto lexicon allows richer embeds (external, record, recordWithMedia)
 * but Phase 3.5 scope is images + single video only.
 */
export type BlueskyEmbed =
  | {
      $type: "app.bsky.embed.images";
      images: Array<{ image: BlueskyBlobRef; alt: string }>;
    }
  | {
      $type: "app.bsky.embed.video";
      video: BlueskyBlobRef;
      alt: string;
    };

export interface BlueskyCreatePostInput {
  text: string;
  embed?: BlueskyEmbed;
}

export class BlueskyClient {
  constructor(
    private readonly identifier: string,
    private readonly password: string,
    private readonly pdsUrl: string = DEFAULT_PDS,
  ) {}

  async createSession(): Promise<BlueskySession> {
    const res = await platformFetch<BlueskySession>({
      method: "POST",
      url: `${this.pdsUrl}/xrpc/com.atproto.server.createSession`,
      body: { identifier: this.identifier, password: this.password },
      platform: PLATFORM,
    });
    if (!res.ok || !res.body) {
      throw authFailed({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        remediation:
          "Verify the identifier (handle or email) and use a Bluesky app password, not the account password. Generate one at https://bsky.app/settings/app-passwords.",
      });
    }
    return res.body;
  }

  /**
   * Upload raw bytes to the PDS. The returned `BlobRef` is what you embed in
   * a record's `embed.images[].image` or `embed.video` field.
   */
  async uploadBlob(
    session: BlueskySession,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<BlueskyBlobRef> {
    const res = await platformFetch<BlueskyUploadBlobResponse>({
      method: "POST",
      url: `${this.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`,
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        "Content-Type": mimeType,
      },
      body: bytes,
      platform: PLATFORM,
    });
    if (!res.ok || !res.body || !res.body.blob) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        ...(extractUpstreamMessage(res.body) !== undefined
          ? { upstreamMessage: extractUpstreamMessage(res.body)! }
          : {}),
        remediation:
          "Upstream rejected the blob upload. Inspect platformResponse; most commonly the blob exceeds per-file limits or the mime type is unsupported.",
      });
    }
    return res.body.blob;
  }

  /**
   * Create an `app.bsky.feed.post` record. Accepts optional `embed` (images
   * or video).
   */
  async createPost(
    session: BlueskySession,
    input: BlueskyCreatePostInput | string,
  ): Promise<BlueskyPostResult> {
    // Keep the legacy string signature so callers that only post text
    // (and any tests pinned to the old shape) keep working.
    const { text, embed } =
      typeof input === "string" ? { text: input, embed: undefined } : input;

    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString(),
    };
    if (embed) record.embed = embed;

    const res = await platformFetch<BlueskyPostResult>({
      method: "POST",
      url: `${this.pdsUrl}/xrpc/com.atproto.repo.createRecord`,
      headers: { Authorization: `Bearer ${session.accessJwt}` },
      body: {
        repo: session.did,
        collection: "app.bsky.feed.post",
        record,
      },
      platform: PLATFORM,
    });
    if (!res.ok || !res.body) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        ...(extractUpstreamMessage(res.body) !== undefined
          ? { upstreamMessage: extractUpstreamMessage(res.body)! }
          : {}),
      });
    }
    return res.body;
  }
}
