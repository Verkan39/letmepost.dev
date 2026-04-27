import type { Platform } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";

/**
 * Describes *how* a caller should connect an account for a given platform.
 * Every platform returns one of these from `describeConnect`, and the
 * /v1/accounts/connect route passes it straight back to the client.
 *
 * OAuth platforms (LinkedIn, X, Meta, Pinterest, YouTube) return a
 * redirect URL + state. Bluesky — the one outlier in v1 — uses app
 * passwords, so it returns a form schema the UI renders and POSTs back
 * to the complete endpoint.
 */
export type ConnectDescriptor =
  | {
      kind: "oauth";
      authorizationUrl: string;
      state: string;
      scopes: readonly string[];
      /**
       * Absolute redirect URI the provider baked into `authorizationUrl`.
       * The client must echo it back on completeConnect so we sign the same
       * exchange we advertised.
       */
      redirectUri: string;
      /**
       * PKCE code verifier for providers that use it (Twitter). The client
       * must stash this across the redirect round-trip and send it back to
       * completeConnect. Undefined for non-PKCE providers.
       */
      codeVerifier?: string;
    }
  | {
      kind: "credentials";
      fields: readonly ConnectField[];
      /** Non-secret helper text shown above the form — e.g. link to app-password settings. */
      helpText?: string;
    };

export type ConnectField = {
  name: string;
  label: string;
  type: "text" | "password" | "url";
  required: boolean;
  placeholder?: string;
  helpText?: string;
};

/**
 * Normalized account record the framework persists. `token` is plaintext
 * here; the repository encrypts on insert. `tokenMetadata` is a per-platform
 * bag — e.g. Bluesky stashes accessJwt/refreshJwt/did; LinkedIn stashes
 * refresh_token + granted scopes.
 */
export type ConnectedAccount = {
  platformAccountId: string;
  displayName: string | null;
  token: string;
  tokenMetadata: Record<string, unknown> | null;
  tokenExpiresAt: Date | null;
};

export type ConnectContext = {
  organizationId: string;
  /** Public-facing API base URL, used by OAuth providers to build redirect URIs. */
  baseUrl: string;
};

/**
 * Input a provider receives at refresh time. The framework calls this
 * when `tokenExpiresAt` is inside `expiringHorizonMs` from now.
 */
export type RefreshInput = {
  token: string;
  tokenMetadata: Record<string, unknown> | null;
};

export type RefreshResult = {
  token: string;
  tokenMetadata: Record<string, unknown> | null;
  tokenExpiresAt: Date | null;
};

/**
 * The contract every platform implements. Keep this surface small —
 * publishing stays in Publisher; this interface is *only* about account
 * lifecycle (connect, refresh, describe).
 */
export interface AccountProvider {
  readonly platform: Platform;
  /**
   * Horizon used by the refresh scheduler. When `tokenExpiresAt` is closer
   * than this, the scheduler calls `refreshToken` and emits `token.expiring`.
   * Bluesky's access JWT lives ~2h → horizon ~30m. LinkedIn/Meta 60d → 7d.
   */
  readonly expiringHorizonMs: number;

  describeConnect(ctx: ConnectContext): Promise<ConnectDescriptor> | ConnectDescriptor;

  /**
   * Finish the connect handshake. For OAuth, `input` carries `{ code, state }`;
   * for credentials, it carries the form payload. Each provider validates and
   * normalizes shape. On success the framework upserts into platform_accounts.
   */
  completeConnect(ctx: ConnectContext, input: unknown): Promise<ConnectedAccount>;

  /**
   * Refresh the stored token. Called by the refresh scheduler and on-demand
   * by publishers that detect `platform_auth_failed`. Returning a new
   * `tokenExpiresAt=null` means "no known expiry" — the scheduler treats
   * that as "never re-refresh from the clock" (event-driven only).
   */
  refreshToken(input: RefreshInput): Promise<RefreshResult>;
}

const registry = new Map<string, AccountProvider>();

export function registerProvider(provider: AccountProvider): void {
  registry.set(provider.platform, provider);
}

/**
 * Look up the provider for a platform string. Accepts `string` rather than
 * the narrow `Platform` union because the DB enum is wider than the
 * user-visible Platform enum (see `db/schema/platform_versions.ts`): the
 * DB knows every future platform so rows for later phases can land without
 * a migration, while the public schema advertises only what's shipped.
 * The registry is the runtime authority.
 */
export function getProvider(platform: string): AccountProvider {
  const provider = registry.get(platform);
  if (!provider) {
    throw new LetmepostError({
      code: "validation_failed",
      status: 400,
      message: `No account provider registered for platform: ${platform}.`,
      remediation:
        "Ensure the platform is one of the v1 supported list. If you're self-hosting, check that the platform's provider module was imported at boot.",
    });
  }
  return provider;
}

export function listRegisteredProviders(): AccountProvider[] {
  return Array.from(registry.values());
}

/** Test-only: reset the registry between suites. */
export function __clearProviderRegistryForTests(): void {
  registry.clear();
}
