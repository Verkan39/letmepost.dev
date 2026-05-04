import { platformFetch } from "../_shared/http.js";
import {
  authFailed,
  extractUpstreamMessage,
  rejected,
} from "../_shared/errors.js";

const PLATFORM = "twitter";

/**
 * X / Twitter API v2 + OAuth 2.0. MVP only touches the `tweets` publish
 * endpoint and the OAuth 2.0 token endpoint.
 */
export const TWITTER_API_BASE = "https://api.twitter.com/2";
export const TWITTER_UPLOAD_BASE = "https://upload.twitter.com/1.1";
export const TWITTER_OAUTH_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
export const TWITTER_OAUTH_AUTHORIZE_URL =
  "https://twitter.com/i/oauth2/authorize";

export interface TwitterTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface TwitterCreateTweetInput {
  text: string;
  mediaIds?: string[];
  /** When set, the new tweet replies to this tweet id. Builds reply chains for threads. */
  replyToTweetId?: string;
  /** When set, the new tweet quote-tweets this tweet id. */
  quoteTweetId?: string;
}

export interface TwitterTweetResponse {
  data: {
    id: string;
    text: string;
  };
}

export interface TwitterMediaUploadResponse {
  media_id_string: string;
  size: number;
}

export class TwitterClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiBase: string = TWITTER_API_BASE,
    private readonly uploadBase: string = TWITTER_UPLOAD_BASE,
  ) {}

  /**
   * POST /2/tweets — create a single tweet.
   *
   * Threading is built by the caller chaining replies: post tweet 1, then
   * post tweet 2 with `replyToTweetId = id1`. We don't build a "thread"
   * primitive here because X has no atomic multi-tweet endpoint and
   * faking it server-side would lie about partial-failure semantics.
   *
   * Quote-tweet: pass `quoteTweetId`. Mutually exclusive with reply at
   * X's API level — preflight catches the combination.
   */
  async createTweet(
    input: TwitterCreateTweetInput,
  ): Promise<TwitterTweetResponse["data"]> {
    const body: Record<string, unknown> = { text: input.text };
    if (input.mediaIds && input.mediaIds.length > 0) {
      body.media = { media_ids: input.mediaIds };
    }
    if (input.replyToTweetId) {
      body.reply = { in_reply_to_tweet_id: input.replyToTweetId };
    }
    if (input.quoteTweetId) {
      body.quote_tweet_id = input.quoteTweetId;
    }

    const res = await platformFetch<TwitterTweetResponse>({
      method: "POST",
      url: `${this.apiBase}/tweets`,
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body,
      platform: PLATFORM,
    });

    if (res.ok && res.body?.data?.id) return res.body.data;
    this.throwForError(res);
  }

  /**
   * `POST /1.1/media/metadata/create` — attach alt-text to a previously-
   * uploaded media id. Best-effort: if it fails (e.g. v1.1 endpoint
   * deprecation), the tweet still goes out without alt text — losing the
   * accessibility metadata is not a publish-breaking failure.
   *
   * Despite living on the v1.1 host, this endpoint is the only documented
   * way to set alt text on uploaded media. v2 has no equivalent yet.
   */
  async setMediaAltText(mediaId: string, altText: string): Promise<void> {
    await platformFetch({
      method: "POST",
      url: `${this.uploadBase}/media/metadata/create.json`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: { media_id: mediaId, alt_text: { text: altText } },
      platform: PLATFORM,
    });
    // Intentionally don't inspect the response. Per X docs, success is 2xx
    // with empty body; we don't need the response shape and we don't want
    // to fail a publish over a metadata write.
  }

  /**
   * v1.1 simple upload (`media/upload.json`) — MVP path for images.
   * v1.1 chunked + v2 media is deferred; leaving a TODO here.
   * TODO(phase-8): chunked upload for video (INIT/APPEND/FINALIZE/STATUS).
   */
  async uploadMedia(bytes: Uint8Array, mimeType: string): Promise<string> {
    // X's v1.1 upload accepts multipart form; for MVP we use the simpler
    // `media_data` base64 route which the v1.1 endpoint supports for
    // small images. Keeps us off multipart until there's a real need.
    const form = new URLSearchParams({
      media_data: Buffer.from(bytes).toString("base64"),
      media_category: mimeType.startsWith("video/")
        ? "tweet_video"
        : mimeType === "image/gif"
          ? "tweet_gif"
          : "tweet_image",
    });

    const res = await platformFetch<TwitterMediaUploadResponse>({
      method: "POST",
      url: `${this.uploadBase}/media/upload.json`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      platform: PLATFORM,
    });

    if (res.ok && res.body?.media_id_string) return res.body.media_id_string;
    this.throwForError(res);
  }

  private throwForError(res: {
    status: number;
    body: unknown;
    raw: string | null;
  }): never {
    const upstreamMessage = extractUpstreamMessage(res.body);
    const lowerMsg = (upstreamMessage ?? "").toLowerCase();

    // Auth failures.
    if (res.status === 401 || lowerMsg.includes("unauthorized")) {
      throw authFailed({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        remediation:
          "Re-connect the X account — the access token is invalid, expired, or missing scopes.",
      });
    }

    // Rate limit.
    if (res.status === 429) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Rate limited by X.",
        remediation:
          "Back off and retry — X enforces per-app and per-user tweet-posting ceilings.",
      });
    }

    // Duplicate tweet — X reports this as code 187 inside a nested `errors`
    // array, or as a top-level `detail` containing the word "duplicate".
    if (isDuplicateTweet(res.body) || lowerMsg.includes("duplicate")) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Duplicate tweet.",
        remediation:
          "X detected this tweet as a duplicate of a recent tweet; vary the content and retry.",
      });
    }

    // Over-length — X code 186 historically.
    if (isTweetTooLong(res.body) || lowerMsg.includes("too long")) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Tweet too long.",
        remediation:
          "Shorten the tweet; letmepost should have caught this in preflight — file a bug.",
      });
    }

    // Unsupported media.
    if (
      lowerMsg.includes("media") &&
      (lowerMsg.includes("unsupported") || lowerMsg.includes("invalid"))
    ) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Unsupported media.",
        remediation:
          "X rejected the media format; use a supported mime type and size.",
      });
    }

    throw rejected({
      platform: PLATFORM,
      platformResponse: res.body ?? res.raw ?? undefined,
      ...(upstreamMessage !== undefined ? { upstreamMessage } : {}),
    });
  }
}

function isDuplicateTweet(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) =>
      e &&
      typeof e === "object" &&
      (e as { code?: number }).code === 187,
  );
}

function isTweetTooLong(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) =>
      e &&
      typeof e === "object" &&
      (e as { code?: number }).code === 186,
  );
}

/* ───── OAuth 2.0 PKCE token exchange ───── */

export async function exchangeTwitterCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl?: string;
}): Promise<TwitterTokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const basic = Buffer.from(
    `${params.clientId}:${params.clientSecret}`,
  ).toString("base64");

  const res = await platformFetch<TwitterTokenResponse>({
    method: "POST",
    url: params.tokenUrl ?? TWITTER_OAUTH_TOKEN_URL,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    platform: PLATFORM,
  });

  if (!res.ok || !res.body?.access_token) {
    throw authFailed({
      platform: PLATFORM,
      platformResponse: res.body ?? res.raw ?? undefined,
      remediation:
        "Verify the X client id / secret, the PKCE code_verifier, and that the redirect URI matches the app registration.",
    });
  }
  return res.body;
}

export async function refreshTwitterToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUrl?: string;
}): Promise<TwitterTokenResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  const basic = Buffer.from(
    `${params.clientId}:${params.clientSecret}`,
  ).toString("base64");

  const res = await platformFetch<TwitterTokenResponse>({
    method: "POST",
    url: params.tokenUrl ?? TWITTER_OAUTH_TOKEN_URL,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
    platform: PLATFORM,
  });

  if (!res.ok || !res.body?.access_token) {
    throw authFailed({
      platform: PLATFORM,
      platformResponse: res.body ?? res.raw ?? undefined,
      remediation:
        "The X refresh token is expired or revoked — have the user re-connect the account.",
    });
  }
  return res.body;
}
