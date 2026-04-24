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
   * POST /2/tweets — create a single tweet. Threading, polls, and
   * quote-tweets are deferred; MVP sends only `text` + optional `media.media_ids`.
   */
  async createTweet(
    input: TwitterCreateTweetInput,
  ): Promise<TwitterTweetResponse["data"]> {
    const body: Record<string, unknown> = { text: input.text };
    if (input.mediaIds && input.mediaIds.length > 0) {
      body.media = { media_ids: input.mediaIds };
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
