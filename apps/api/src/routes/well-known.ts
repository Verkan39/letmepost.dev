import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Hono } from "hono";
import { auth, baseAuthUrl } from "../auth.js";

/**
 * Public OAuth / OIDC discovery surface mounted at the root so RFC-compliant
 * clients can locate the authorization-server config without configuration.
 *
 * - `/.well-known/openid-configuration`     → OIDC discovery doc
 * - `/.well-known/oauth-authorization-server` → OAuth 2.1 AS metadata
 * - `/.well-known/oauth-protected-resource`   → RFC 9728 protected-resource doc
 *
 * The first two delegate to better-auth's oauth-provider plugin (which already
 * knows every endpoint, signing alg, scope, etc. it registered). The third we
 * hand-roll — RFC 9728 says it lives on the resource server, not the AS,
 * advertising which authorization server(s) protect this resource.
 */
export const wellKnown = new Hono();

const authServerHandler = oauthProviderAuthServerMetadata(auth);
const openIdHandler = oauthProviderOpenIdConfigMetadata(auth);

wellKnown.get("/openid-configuration", (c) => openIdHandler(c.req.raw));
wellKnown.get("/oauth-authorization-server", (c) =>
  authServerHandler(c.req.raw),
);

/**
 * RFC 9728 §3 — protected-resource metadata. Lets MCP clients walk from a
 * 401 + `WWW-Authenticate: Bearer resource_metadata=…` hint to discover which
 * authorization servers issue valid tokens for this API. We're both the
 * resource server and the AS so `authorization_servers` points at ourselves.
 */
wellKnown.get("/oauth-protected-resource", (c) => {
  // `resource` is the API itself. `authorization_servers[0]` must match the
  // `issuer` claim from the AS metadata or MCP clients refuse the discovery
  // hand-off — better-auth's issuer is the mount-point of the auth handler
  // (`${baseAuthUrl}/api/auth`), not the bare API host.
  return c.json({
    resource: baseAuthUrl,
    authorization_servers: [`${baseAuthUrl}/api/auth`],
    scopes_supported: ["publish", "read", "openid", "offline_access"],
    bearer_methods_supported: ["header"],
  });
});
