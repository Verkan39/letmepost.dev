import type { MiddlewareHandler } from "hono";
import { verifyAccessToken } from "better-auth/oauth2";
import { baseAuthUrl, validAudiences } from "../auth.js";
import { LetmepostError } from "../errors.js";

export type OAuthContext = {
  /** `sub` claim — the better-auth user id this token was issued to. */
  userId: string;
  /** Scope strings granted on this token (e.g. `publish`, `read`). */
  scopes: string[];
  /** `client_id` claim — the OAuth client that obtained the token (i.e. the
   * MCP client install: "claude-desktop", "cursor", …). */
  clientId: string;
};

declare module "hono" {
  interface ContextVariableMap {
    oauth?: OAuthContext;
  }
}

/**
 * URL where the auth server publishes its JWK set. `verifyAccessToken` uses
 * this to fetch the verification key the first time it sees a new `kid` —
 * caching is internal to better-auth.
 */
const JWKS_URL = `${baseAuthUrl}/api/auth/jwks`;

/**
 * Validates an `Authorization: Bearer <jwt>` header against the OAuth
 * provider's signing keys, audience, and issuer. On success attaches
 * `{ userId, scopes, clientId }` to `c.var.oauth` for downstream routes to
 * consult. On any failure throws `LetmepostError(unauthenticated)` so the
 * caller sees a consistent error envelope — same shape `api-key.ts` emits.
 *
 * Intended to be layered onto the MCP route (and any other surface MCP
 * clients hit) as an alternative to `apiKeyAuth()`. Routes that accept
 * either token type should compose both middlewares with an OR — that lives
 * in the consuming route, not here.
 */
export function oauthBearer(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "Missing or malformed Authorization header.",
        remediation:
          "Send Authorization: Bearer <oauth-token> with every request.",
      });
    }
    const token = header.slice("Bearer ".length).trim();
    if (token.length === 0) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "Empty bearer token.",
        remediation:
          "Send Authorization: Bearer <oauth-token> with every request.",
      });
    }

    let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
    try {
      payload = await verifyAccessToken(token, {
        jwksUrl: JWKS_URL,
        verifyOptions: {
          // better-auth's issuer is its mount path, not the bare API host.
          issuer: `${baseAuthUrl}/api/auth`,
          // Accept any audience we declared — MCP tokens come back with
          // `aud=https://api.letmepost.dev/mcp` (RFC 8707 resource indicator)
          // while CLI / api-key-mint tokens use the bare API URL.
          audience: validAudiences,
        },
      });
    } catch (err) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "OAuth access token is invalid or expired.",
        remediation:
          "Refresh the token via the OAuth provider or re-authenticate the MCP client.",
        platformResponse:
          err instanceof Error ? { reason: err.message } : undefined,
      });
    }

    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const clientId =
      typeof payload.client_id === "string" ? payload.client_id : "";
    if (!userId || !clientId) {
      throw new LetmepostError({
        code: "unauthenticated",
        status: 401,
        message: "OAuth token is missing required claims.",
        remediation:
          "Token must include `sub` (user id) and `client_id`. Re-issue the token via /oauth2/token.",
      });
    }

    // `scope` is the OAuth-standard space-delimited string; `scopes` is the
    // array form some providers emit. Accept either to stay forgiving.
    const rawScope = payload.scope;
    const rawScopes = (payload as { scopes?: unknown }).scopes;
    let scopes: string[] = [];
    if (typeof rawScope === "string") {
      scopes = rawScope.split(" ").filter(Boolean);
    } else if (Array.isArray(rawScopes)) {
      scopes = rawScopes.filter((s): s is string => typeof s === "string");
    }

    c.set("oauth", { userId, scopes, clientId });
    await next();
  };
}
