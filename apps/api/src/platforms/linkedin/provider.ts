import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LetmepostError } from "../../errors.js";
import type {
  AccountProvider,
  ConnectContext,
  ConnectDescriptor,
  ConnectedAccount,
  RefreshInput,
  RefreshResult,
} from "../_shared/provider.js";
import { scopeSetFor } from "../_shared/scopes.js";
import {
  exchangeLinkedInCode,
  LINKEDIN_API_BASE,
  LINKEDIN_DEFAULT_VERSION,
  LINKEDIN_OAUTH_AUTHORIZE_URL,
  LinkedInClient,
  refreshLinkedInToken,
  type LinkedInTokenResponse,
} from "./client.js";

/**
 * LinkedIn provider — 3-legged OAuth 2.0 (no PKCE on the standard tier).
 *
 * Access tokens live ~60 days. Refresh tokens live a year unless revoked.
 * Refresh horizon = 7 days (per plan.md sizing for 60-day-class platforms).
 *
 * What we persist after connect:
 *   - `token`        = access token (used for /rest/posts + /v2/userinfo)
 *   - `tokenMetadata`= { refreshToken, refreshTokenExpiresAt, grantedScopes,
 *                        authorUrn, displayName, picture, apiBase?,
 *                        authorizeUrl?, tokenUrl? }
 *   - `tokenExpiresAt` = now + access_token expires_in
 */

const PLATFORM = "linkedin";
const EXPIRING_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export type LinkedInProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  /** Override the authorize URL for tests. */
  authorizeUrl?: string;
  /** Override the token URL for tests. */
  tokenUrl?: string;
  /** Override the API base for tests / sandbox. */
  apiBase?: string;
};

const CompleteConnectInput = z.object({
  code: z.string().min(1, "LinkedIn OAuth code is required."),
  state: z.string().min(1, "OAuth state is required."),
  redirectUri: z.string().url("redirectUri must be a URL."),
});

export type LinkedInTokenMetadata = {
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  grantedScopes?: string[];
  authorUrn?: string;
  displayName?: string;
  picture?: string;
  apiBase?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
};

function computeRedirectUri(baseUrl: string): string {
  return new URL("/v1/accounts/oauth/linkedin/callback", baseUrl).toString();
}

function expiresAtFrom(resp: LinkedInTokenResponse): Date {
  return new Date(Date.now() + resp.expires_in * 1000);
}

function refreshExpiresAtFrom(resp: LinkedInTokenResponse): string | undefined {
  if (typeof resp.refresh_token_expires_in !== "number") return undefined;
  return new Date(Date.now() + resp.refresh_token_expires_in * 1000).toISOString();
}

function readRefreshToken(
  tokenMetadata: Record<string, unknown> | null,
): string | null {
  if (!tokenMetadata) return null;
  const rt = (tokenMetadata as LinkedInTokenMetadata).refreshToken;
  return typeof rt === "string" && rt.length > 0 ? rt : null;
}

function buildMetadata(args: {
  resp: LinkedInTokenResponse;
  config: LinkedInProviderConfig;
  authorUrn?: string;
  displayName?: string;
  picture?: string;
}): LinkedInTokenMetadata {
  const md: LinkedInTokenMetadata = {
    grantedScopes: args.resp.scope.split(/\s+/).filter(Boolean),
  };
  if (args.resp.refresh_token) md.refreshToken = args.resp.refresh_token;
  const refreshExp = refreshExpiresAtFrom(args.resp);
  if (refreshExp) md.refreshTokenExpiresAt = refreshExp;
  if (args.authorUrn) md.authorUrn = args.authorUrn;
  if (args.displayName) md.displayName = args.displayName;
  if (args.picture) md.picture = args.picture;
  if (args.config.apiBase) md.apiBase = args.config.apiBase;
  if (args.config.authorizeUrl) md.authorizeUrl = args.config.authorizeUrl;
  if (args.config.tokenUrl) md.tokenUrl = args.config.tokenUrl;
  return md;
}

export class LinkedInProvider implements AccountProvider {
  readonly platform = PLATFORM;
  readonly expiringHorizonMs = EXPIRING_HORIZON_MS;

  constructor(private readonly config: LinkedInProviderConfig = {}) {}

  describeConnect(ctx: ConnectContext): ConnectDescriptor {
    const scopes = [...scopeSetFor(PLATFORM).write];
    const state = randomUUID();
    const redirectUri = computeRedirectUri(ctx.baseUrl);
    const url = new URL(this.config.authorizeUrl ?? LINKEDIN_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.resolveClientId());
    url.searchParams.set("redirect_uri", redirectUri);
    // LinkedIn expects a space-separated scope list, percent-encoded.
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    return {
      kind: "oauth",
      authorizationUrl: url.toString(),
      state,
      scopes,
      redirectUri,
    };
  }

  async completeConnect(
    _ctx: ConnectContext,
    raw: unknown,
  ): Promise<ConnectedAccount> {
    const parsed = CompleteConnectInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Invalid LinkedIn connect payload.",
        rule: issue?.path.join(".") || "body",
        platformResponse: parsed.error.issues,
      });
    }
    const { code, redirectUri } = parsed.data;

    const exchangeArgs: Parameters<typeof exchangeLinkedInCode>[0] = {
      clientId: this.resolveClientId(),
      clientSecret: this.resolveClientSecret(),
      code,
      redirectUri,
    };
    if (this.config.tokenUrl) exchangeArgs.tokenUrl = this.config.tokenUrl;
    const tokens = await exchangeLinkedInCode(exchangeArgs);

    // Resolve the member's stable id so we can store the canonical author URN.
    const client = new LinkedInClient(
      tokens.access_token,
      this.config.apiBase ?? LINKEDIN_API_BASE,
      LINKEDIN_DEFAULT_VERSION,
    );
    const userinfo = await client.fetchUserInfo();
    const authorUrn = `urn:li:person:${userinfo.sub}`;
    const composed = [userinfo.given_name, userinfo.family_name]
      .filter(Boolean)
      .join(" ");
    const displayName =
      userinfo.name ?? (composed.length > 0 ? composed : undefined);

    return {
      platformAccountId: userinfo.sub,
      displayName: displayName ?? null,
      token: tokens.access_token,
      tokenMetadata: buildMetadata({
        resp: tokens,
        config: this.config,
        authorUrn,
        ...(displayName ? { displayName } : {}),
        ...(userinfo.picture ? { picture: userinfo.picture } : {}),
      }),
      tokenExpiresAt: expiresAtFrom(tokens),
    };
  }

  async refreshToken(input: RefreshInput): Promise<RefreshResult> {
    const refresh = readRefreshToken(input.tokenMetadata);
    if (!refresh) {
      throw new LetmepostError({
        code: "platform_auth_failed",
        status: 401,
        platform: PLATFORM,
        message: "Cannot refresh LinkedIn token — no refresh token stored.",
        remediation:
          "Reconnect the account via POST /v1/accounts/connect/linkedin.",
      });
    }
    const refreshArgs: Parameters<typeof refreshLinkedInToken>[0] = {
      clientId: this.resolveClientId(),
      clientSecret: this.resolveClientSecret(),
      refreshToken: refresh,
    };
    if (this.config.tokenUrl) refreshArgs.tokenUrl = this.config.tokenUrl;
    const tokens = await refreshLinkedInToken(refreshArgs);

    // Carry the previously-resolved author URN forward — refresh doesn't
    // re-mint identity claims, so we don't need to re-fetch `/v2/userinfo`.
    const prior = (input.tokenMetadata ?? {}) as LinkedInTokenMetadata;
    const carryArgs: Parameters<typeof buildMetadata>[0] = {
      resp: tokens,
      config: this.config,
    };
    if (prior.authorUrn) carryArgs.authorUrn = prior.authorUrn;
    if (prior.displayName) carryArgs.displayName = prior.displayName;
    if (prior.picture) carryArgs.picture = prior.picture;

    return {
      token: tokens.access_token,
      tokenMetadata: buildMetadata(carryArgs),
      tokenExpiresAt: expiresAtFrom(tokens),
    };
  }

  private resolveClientId(): string {
    return this.config.clientId ?? process.env.LINKEDIN_CLIENT_ID ?? "";
  }

  private resolveClientSecret(): string {
    return (
      this.config.clientSecret ?? process.env.LINKEDIN_CLIENT_SECRET ?? ""
    );
  }
}

export const linkedinProvider = new LinkedInProvider();
