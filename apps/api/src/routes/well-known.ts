import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Hono } from "hono";
import { auth, baseAuthUrl } from "../auth.js";

/**
 * Public OAuth / OIDC discovery surface. RFC 8414 (oauth-authorization-server)
 * and RFC 9728 (oauth-protected-resource) BOTH say the metadata path must
 * suffix the issuer / resource path onto the well-known prefix. Our issuer is
 * `${baseAuthUrl}/api/auth` and our MCP resource is `${baseAuthUrl}/mcp`, so
 * we serve:
 *
 *   /.well-known/oauth-authorization-server            ← bare, RFC 8414 default
 *   /.well-known/oauth-authorization-server/api/auth   ← issuer-suffixed
 *   /.well-known/openid-configuration                  ← OIDC bare
 *   /.well-known/openid-configuration/api/auth         ← OIDC issuer-suffixed
 *   /.well-known/oauth-protected-resource              ← resource: bare API
 *   /.well-known/oauth-protected-resource/mcp          ← resource: /mcp
 *
 * MCP clients (Claude Code, Claude Desktop) try the suffixed forms first
 * since the resource URL they're hitting is /mcp and the AS issuer they
 * discover has the /api/auth path. Without the suffixed routes the entire
 * OAuth dance 404s at the first hop.
 *
 * The first two helpers come from @better-auth/oauth-provider; the third we
 * hand-roll since RFC 9728 metadata is resource-side, not AS-side.
 */
export const wellKnown = new Hono();

const authServerHandler = oauthProviderAuthServerMetadata(auth);
const openIdHandler = oauthProviderOpenIdConfigMetadata(auth);

wellKnown.get("/openid-configuration", (c) => openIdHandler(c.req.raw));
wellKnown.get("/openid-configuration/api/auth", (c) =>
  openIdHandler(c.req.raw),
);
wellKnown.get("/oauth-authorization-server", (c) =>
  authServerHandler(c.req.raw),
);
wellKnown.get("/oauth-authorization-server/api/auth", (c) =>
  authServerHandler(c.req.raw),
);

function protectedResourceFor(resourceUrl: string) {
  return {
    resource: resourceUrl,
    // Must match the `issuer` claim from the AS metadata or MCP clients
    // refuse the discovery hand-off.
    authorization_servers: [`${baseAuthUrl}/api/auth`],
    scopes_supported: ["publish", "read", "openid", "offline_access"],
    bearer_methods_supported: ["header"],
  };
}

wellKnown.get("/oauth-protected-resource", (c) =>
  c.json(protectedResourceFor(baseAuthUrl)),
);
// MCP-specific resource. RFC 9728 says the metadata URL appends the resource
// path; the MCP spec treats /mcp as the protected resource, so this is the
// path Claude Code probes first.
wellKnown.get("/oauth-protected-resource/mcp", (c) =>
  c.json(protectedResourceFor(`${baseAuthUrl}/mcp`)),
);
