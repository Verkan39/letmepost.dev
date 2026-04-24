import { platformFetch } from "../_shared/http.js";
import {
  authFailed,
  extractUpstreamMessage,
  rejected,
} from "../_shared/errors.js";
import { LetmepostError } from "../../errors.js";

const PLATFORM = "pinterest";

/**
 * Pinterest API v5 hosts.
 *   - Production:  https://api.pinterest.com/v5
 *   - Sandbox:     https://api-sandbox.pinterest.com/v5  (unused in MVP)
 */
export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
export const PINTEREST_OAUTH_TOKEN_URL =
  "https://api.pinterest.com/v5/oauth/token";
export const PINTEREST_OAUTH_AUTHORIZE_URL =
  "https://www.pinterest.com/oauth/";

export interface PinterestTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope: string;
}

export interface PinterestCreatePinInput {
  /** Pinterest board id the pin lands on. */
  boardId: string;
  /** Caller-facing click-through URL displayed on the pin. */
  destinationUrl: string;
  /** Pin title; optional per Pinterest docs, MVP allows it through. */
  title?: string;
  /** Pin description / caption. */
  description?: string;
  /** Public image URL. MVP: single image only. */
  imageUrl: string;
}

export interface PinterestPin {
  id: string;
  board_id: string;
  link: string | null;
}

export class PinterestClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiBase: string = PINTEREST_API_BASE,
  ) {}

  /**
   * POST /v5/pins — create a pin. Pinterest returns 201 + pin body on success.
   *
   * Error mapping:
   *   - 401 / invalid_token  → platform_auth_failed
   *   - 409 or `duplicate` in message → platform_rejected with duplicate remediation
   *   - 400 with URL-reachability message → platform_rejected (passthrough)
   *   - 429                  → platform_rejected with rate-limit remediation
   *   - other non-2xx        → platform_rejected
   */
  async createPin(input: PinterestCreatePinInput): Promise<PinterestPin> {
    const body: Record<string, unknown> = {
      board_id: input.boardId,
      link: input.destinationUrl,
      media_source: {
        source_type: "image_url",
        url: input.imageUrl,
      },
    };
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;

    const res = await platformFetch<PinterestPin>({
      method: "POST",
      url: `${this.apiBase}/pins`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body,
      platform: PLATFORM,
    });

    if (res.ok && res.body?.id) return res.body;

    // Auth failures — 401 is the common signal; some Pinterest errors also
    // report `code: 9` (permission scope) or message including "invalid_token".
    const upstreamMessage = extractUpstreamMessage(res.body);
    const lowerMsg = (upstreamMessage ?? "").toLowerCase();
    if (res.status === 401 || lowerMsg.includes("invalid_token")) {
      throw authFailed({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        remediation:
          "Re-connect the Pinterest account — the access token is invalid or revoked.",
      });
    }

    // Rate-limit.
    if (res.status === 429) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Rate limited by Pinterest.",
        remediation:
          "Back off and retry; Pinterest enforces per-app and per-account quotas.",
      });
    }

    // Duplicate-pin detection. Pinterest's surface language here varies — we
    // check a few canonical phrases used in the v5 error schema.
    if (
      res.status === 409 ||
      lowerMsg.includes("duplicate") ||
      lowerMsg.includes("already exists")
    ) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Duplicate pin.",
        remediation:
          "Pinterest rejected the pin as a duplicate of an existing pin on this board.",
      });
    }

    // Unreachable / invalid image URL.
    if (
      lowerMsg.includes("image") &&
      (lowerMsg.includes("unreachable") ||
        lowerMsg.includes("invalid") ||
        lowerMsg.includes("could not fetch"))
    ) {
      throw rejected({
        platform: PLATFORM,
        platformResponse: res.body ?? res.raw ?? undefined,
        upstreamMessage: upstreamMessage ?? "Pinterest could not fetch the image URL.",
        remediation:
          "Ensure the image URL is publicly reachable and serves a supported image mime type.",
      });
    }

    throw rejected({
      platform: PLATFORM,
      platformResponse: res.body ?? res.raw ?? undefined,
      ...(upstreamMessage !== undefined ? { upstreamMessage } : {}),
    });
  }
}

/**
 * Exchange an auth code for tokens. Shared by the provider on connect and
 * a separate path (unused in MVP) for re-connection flows.
 */
export async function exchangePinterestCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  tokenUrl?: string;
}): Promise<PinterestTokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const basic = Buffer.from(
    `${params.clientId}:${params.clientSecret}`,
  ).toString("base64");

  const res = await platformFetch<PinterestTokenResponse>({
    method: "POST",
    url: params.tokenUrl ?? PINTEREST_OAUTH_TOKEN_URL,
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
        "Verify the Pinterest client id / secret and the redirect URI matches the app registration.",
    });
  }
  return res.body;
}

export async function refreshPinterestToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenUrl?: string;
}): Promise<PinterestTokenResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  const basic = Buffer.from(
    `${params.clientId}:${params.clientSecret}`,
  ).toString("base64");

  const res = await platformFetch<PinterestTokenResponse>({
    method: "POST",
    url: params.tokenUrl ?? PINTEREST_OAUTH_TOKEN_URL,
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
        "The Pinterest refresh token is expired or revoked — have the user re-connect the account.",
    });
  }
  return res.body;
}

/** Raised by preflight when URL reachability is probed via HEAD. */
export function unreachableUrl(url: string, detail: string): LetmepostError {
  return new LetmepostError({
    code: "preflight_failed",
    status: 400,
    message: `URL unreachable: ${url} (${detail}).`,
    rule: "pinterest.url.reachable",
    platform: PLATFORM,
    remediation:
      "Pinterest needs the image + destination URLs to be publicly reachable; verify they return 200.",
  });
}
