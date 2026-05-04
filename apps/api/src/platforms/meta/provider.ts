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
  exchangeFacebookCode,
  exchangeFacebookForLongLived,
  META_GRAPH_BASE,
  META_GRAPH_VERSION,
  META_OAUTH_AUTHORIZE_URL,
  MetaDiscoveryClient,
  type MetaPageAccount,
} from "./client.js";

/**
 * Meta provider — registered as `"facebook"` for the connect surface,
 * but fans out on completeConnect to produce one row per Page (`facebook`)
 * and one row per linked IG Business account (`instagram`). One OAuth
 * grant, multiple platform_accounts rows.
 *
 * Why `"facebook"` for the connect URL and not `"meta"`:
 *   - The `Platform` enum is the source of truth; adding "meta" pollutes
 *     it with a value that's never the platform of a real post (you
 *     publish to facebook OR instagram, never to "meta").
 *   - The OAuth callback router validates against the same enum.
 *   - The provider registry can hold `"facebook"`, then fan out to both
 *     platforms via `ConnectedAccount[]` — no enum bloat.
 *
 * What we persist after connect:
 *   For each Page row (`facebook`):
 *     - `platformAccountId` = Page id
 *     - `displayName`       = Page name
 *     - `token`             = Page Access Token (NON-EXPIRING with FBLB)
 *     - `tokenMetadata`     = `{ kind: "page", userTokenLongLived?, igLinked? }`
 *
 *   For each IG Business row (`instagram`):
 *     - `platformAccountId` = IG Business account id
 *     - `displayName`       = IG @handle
 *     - `token`             = the parent Page's access token (IG publishes via the Page token)
 *     - `tokenMetadata`     = `{ kind: "instagram", pageId, pageAccountId? }`
 *
 * Refresh: Page Access Tokens derived from a long-lived User token are
 * non-expiring (Meta's documented contract). The refreshToken
 * implementation is therefore a no-op that re-uses the stored token.
 * If the user revokes via Settings → Apps, the next API call surfaces
 * `platform_auth_failed` and the dashboard prompts re-connect.
 */

const PLATFORM = "facebook";
/** Long-lived user token expires in 60d, but Page tokens are non-expiring. */
const EXPIRING_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

export type MetaProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  graphBase?: string;
  graphVersion?: string;
};

const CompleteConnectInput = z.object({
  code: z.string().min(1, "Meta OAuth code is required."),
  state: z.string().min(1, "OAuth state is required."),
  redirectUri: z.string().url("redirectUri must be a URL."),
});

export type FacebookPageMetadata = {
  /** Discriminant — "page" for FB Page rows, "instagram" for IG rows. */
  kind: "page";
  /** Tasks the user has been granted on this Page (e.g. CREATE_CONTENT). */
  pageTasks?: string[];
  /** True when this Page has a linked IG Business account (the IG row exists). */
  igLinked?: boolean;
  /** The corresponding IG Business id, when set. */
  igBusinessAccountId?: string;
};

export type InstagramAccountMetadata = {
  kind: "instagram";
  /**
   * Parent Facebook Page id. Required for refresh / re-discovery — IG
   * Business publishing always goes through the linked Page's access
   * token, so we keep the lineage explicit.
   */
  pageId: string;
  /** letmepost id of the corresponding facebook row (for cross-linking on dashboard). */
  pageAccountId?: string;
};

function computeRedirectUri(baseUrl: string): string {
  return new URL("/v1/accounts/oauth/facebook/callback", baseUrl).toString();
}

function expiresAtFrom(expiresInSeconds: number | undefined): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/**
 * Build the ConnectedAccount records for a single Page, plus its linked IG
 * Business account when present. Returns 1-or-2 records per Page.
 */
async function expandPage(
  page: MetaPageAccount,
  client: MetaDiscoveryClient,
): Promise<ConnectedAccount[]> {
  const out: ConnectedAccount[] = [];

  const fbMeta: FacebookPageMetadata = { kind: "page" };
  if (page.tasks) fbMeta.pageTasks = page.tasks;
  if (page.instagram_business_account?.id) {
    fbMeta.igLinked = true;
    fbMeta.igBusinessAccountId = page.instagram_business_account.id;
  }

  out.push({
    platform: "facebook",
    platformAccountId: page.id,
    displayName: page.name,
    token: page.access_token,
    tokenMetadata: fbMeta as unknown as Record<string, unknown>,
    // Page tokens are non-expiring; null tells the refresh scheduler
    // "never re-refresh from the clock" — event-driven only.
    tokenExpiresAt: null,
  });

  if (page.instagram_business_account?.id) {
    const igId = page.instagram_business_account.id;
    const igUser = await client.getInstagramUser(igId);
    const igMeta: InstagramAccountMetadata = {
      kind: "instagram",
      pageId: page.id,
    };
    out.push({
      platform: "instagram",
      platformAccountId: igId,
      displayName: igUser.username ?? igUser.name ?? null,
      // Same Page token — IG Business publishing is gated on the Page's
      // permission, not a separate IG token.
      token: page.access_token,
      tokenMetadata: igMeta as unknown as Record<string, unknown>,
      tokenExpiresAt: null,
    });
  }

  return out;
}

export class MetaProvider implements AccountProvider {
  readonly platform = PLATFORM;
  readonly expiringHorizonMs = EXPIRING_HORIZON_MS;

  constructor(private readonly config: MetaProviderConfig = {}) {}

  describeConnect(ctx: ConnectContext): ConnectDescriptor {
    const scopes = [...scopeSetFor(PLATFORM).write];
    const state = ctx.oauthState ?? randomUUID();
    const redirectUri = computeRedirectUri(ctx.baseUrl);
    const url = new URL(
      this.config.authorizeUrl ?? META_OAUTH_AUTHORIZE_URL,
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.resolveClientId());
    url.searchParams.set("redirect_uri", redirectUri);
    // Meta accepts comma-separated scopes.
    url.searchParams.set("scope", scopes.join(","));
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
  ): Promise<ConnectedAccount[]> {
    const parsed = CompleteConnectInput.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new LetmepostError({
        code: "validation_failed",
        status: 400,
        message: issue?.message ?? "Invalid Meta connect payload.",
        rule: issue?.path.join(".") || "body",
        platformResponse: parsed.error.issues,
      });
    }
    const { code, redirectUri } = parsed.data;

    const exchangeArgs: Parameters<typeof exchangeFacebookCode>[0] = {
      clientId: this.resolveClientId(),
      clientSecret: this.resolveClientSecret(),
      code,
      redirectUri,
    };
    if (this.config.tokenUrl) exchangeArgs.tokenUrl = this.config.tokenUrl;
    const short = await exchangeFacebookCode(exchangeArgs);

    // Swap to long-lived. Page tokens derived from this are non-expiring,
    // so we want the long path even though we discard the User token
    // after `listPages`.
    const longArgs: Parameters<typeof exchangeFacebookForLongLived>[0] = {
      clientId: this.resolveClientId(),
      clientSecret: this.resolveClientSecret(),
      shortLivedToken: short.access_token,
    };
    if (this.config.tokenUrl) longArgs.tokenUrl = this.config.tokenUrl;
    const long = await exchangeFacebookForLongLived(longArgs);
    void expiresAtFrom; // long.expires_in is informational; Page tokens don't inherit it

    const graphBase = this.config.graphBase ?? META_GRAPH_BASE;
    const version = this.config.graphVersion ?? META_GRAPH_VERSION;
    const client = new MetaDiscoveryClient(long.access_token, graphBase, version);

    const pages = await client.listPages();
    if (pages.length === 0) {
      throw new LetmepostError({
        code: "platform_rejected",
        status: 400,
        platform: PLATFORM,
        message:
          "The connected user manages no Facebook Pages — letmepost has nothing to publish to.",
        rule: "facebook.pages.none",
        remediation:
          "Connect a user who administers at least one Facebook Page (Pages > Settings > New Roles, or transfer ownership). Personal-feed posting is not part of the v1 scope.",
      });
    }

    // Expand each Page into FB + (optional) IG records. Sequential rather
    // than parallel — IG lookups are cheap and Meta's rate limits at
    // connect time are loose; not worth the extra error-handling for
    // partial failures.
    const records: ConnectedAccount[] = [];
    for (const page of pages) {
      const expanded = await expandPage(page, client);
      records.push(...expanded);
    }
    return records;
  }

  async refreshToken(input: RefreshInput): Promise<RefreshResult> {
    // Page tokens derived from a long-lived User token are non-expiring.
    // The scheduler may still call this if `tokenExpiresAt` was set
    // (e.g. legacy rows from a prior provider implementation) — return
    // the existing token unchanged. If Meta has actually revoked, the
    // next API call surfaces 190/102 and the dashboard nudges
    // re-connect; the refresh path doesn't try to "fix" that itself
    // because we have no User token in hand here.
    return {
      token: input.token,
      tokenMetadata: input.tokenMetadata,
      tokenExpiresAt: null,
    };
  }

  private resolveClientId(): string {
    return this.config.clientId ?? process.env.META_APP_ID ?? "";
  }

  private resolveClientSecret(): string {
    return this.config.clientSecret ?? process.env.META_APP_SECRET ?? "";
  }
}

export const metaProvider = new MetaProvider();
