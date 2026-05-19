// Hosted MCP endpoint at /mcp. Streamable HTTP transport, stateless mode.
//
// Auth: standard Authorization: Bearer lmp_live_... header. Every tool call
// uses the caller's API key — the same one they'd pass directly to /v1/*.
//
// Tool surface is generated from the OpenAPI spec at startup (see
// @letmepost/mcp/autogen). The stdio binary in apps/mcp uses the same
// projection, so the hosted and local servers expose an identical tool list.
//
// Tool execution loops back over HTTP to this same instance. That keeps the
// code path identical to the stdio MCP server: both shapes go through the
// public REST API, so all middleware (idempotency, rate limits, preflight,
// audit) runs uniformly. The loopback adds ~10ms which is in the noise next
// to upstream platform latency.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAccessToken } from "better-auth/oauth2";

import {
  type AutogenTool,
  loadAutogenTools,
} from "@letmepost/mcp/autogen";

import { baseAuthUrl, validAudiences } from "../auth.js";
import type { DrizzleClient } from "../db/index.js";
import { apiKeys } from "../db/schema/api_keys.js";
import { member } from "../db/schema/auth.js";
import { LetmepostError } from "../errors.js";

// Public origin used to build the resource_metadata URL in the
// WWW-Authenticate hint. Falls back to localhost for dev so the header is
// always populated and MCP clients can discover the auth surface.
const RESOURCE_METADATA_URL = `${
  process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
}/.well-known/oauth-protected-resource/mcp`;

// Resolve the spec next to the compiled route. The copy-openapi.mjs build
// step writes it into src/routes/ for dev and dist/routes/ for prod.
const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "openapi.json");

const tools = loadAutogenTools(specPath);
const toolIndex = new Map<string, AutogenTool>(tools.map((t) => [t.name, t]));

function buildServer(apiKey: string, loopbackBaseUrl: string): Server {
  const server = new Server(
    { name: "letmepost", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = toolIndex.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
      };
    }
    try {
      const result = await tool.execute(
        (args as Record<string, unknown>) ?? {},
        { apiKey, baseUrl: loopbackBaseUrl },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  return server;
}

// In-process cache mapping OAuth user id → minted api key plaintext. Persists
// for the lifetime of the Node process; we re-mint after a restart, which is
// fine (old keys stay valid in the DB; the cache miss just costs one extra
// INSERT). Keyed by JWT `sub` so multiple devices for the same user share the
// same loopback key.
const jwtUserToApiKey = new Map<string, string>();

const JWKS_URL = `${baseAuthUrl}/api/auth/jwks`;

function hashKeyForStorage(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function mintKey(): string {
  return `lmp_live_${randomBytes(24).toString("base64url")}`;
}

async function resolveLoopbackKey(c: Context): Promise<string> {
  const header = c.req.header("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new LetmepostError({
      code: "unauthenticated",
      status: 401,
      message: "Missing or malformed Authorization header.",
      remediation:
        "Send Authorization: Bearer <api-key-or-oauth-token> with every request.",
    });
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new LetmepostError({
      code: "unauthenticated",
      status: 401,
      message: "Empty bearer token.",
    });
  }

  // API-key path. Trust the prefix as the signal that this is a key, not a
  // JWT; the actual validation happens when /v1/* receives the loopback
  // request and runs apiKeyAuth() against the api_keys table.
  if (token.startsWith("lmp_live_") || token.startsWith("lmp_test_")) {
    return token;
  }

  // OAuth JWT path. Verify the token against the JWKS, then look up (or mint)
  // an api key bound to the user's primary org. We cache the plaintext in
  // memory so repeated MCP calls don't each fire an INSERT.
  let payload: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    payload = await verifyAccessToken(token, {
      jwksUrl: JWKS_URL,
      verifyOptions: {
        issuer: `${baseAuthUrl}/api/auth`,
        audience: validAudiences,
      },
    });
  } catch (err) {
    throw new LetmepostError({
      code: "unauthenticated",
      status: 401,
      message: "OAuth access token is invalid or expired.",
      remediation:
        "Re-run the OAuth flow from your MCP client (Disable + Authenticate).",
      platformResponse:
        err instanceof Error ? { reason: err.message } : undefined,
    });
  }
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) {
    throw new LetmepostError({
      code: "unauthenticated",
      status: 401,
      message: "OAuth token is missing the `sub` claim.",
    });
  }

  const cached = jwtUserToApiKey.get(userId);
  if (cached) return cached;

  const db = c.var.db as DrizzleClient;
  const [m] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);
  const organizationId = m?.organizationId;
  if (!organizationId) {
    throw new LetmepostError({
      code: "not_found",
      status: 404,
      rule: "user.no_organization",
      message: "Authenticated user is not a member of any organization.",
      remediation:
        "Sign in to the dashboard and create or join an organization, then re-authenticate the MCP client.",
    });
  }

  const plaintext = mintKey();
  await db.insert(apiKeys).values({
    organizationId,
    profileId: null,
    name: "letmepost-mcp",
    prefix: "lmp_live_",
    hashedKey: hashKeyForStorage(plaintext),
    last4: plaintext.slice(-4),
    scopes: [],
  });
  jwtUserToApiKey.set(userId, plaintext);
  return plaintext;
}

export const mcp = new Hono();

// CORS-style preflight for MCP clients that probe before the actual POST.
mcp.options("/", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, content-type, mcp-session-id",
  }),
);

// Per MCP Authorization spec, the resource server SHOULD include a
// WWW-Authenticate header pointing at its protected-resource metadata so
// clients can discover the OAuth surface without out-of-band config. We
// emit it on every /mcp response — harmless on 200, load-bearing on 401.
mcp.use("/", async (c, next) => {
  c.header(
    "WWW-Authenticate",
    `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
  );
  await next();
});

mcp.post("/", async (c) => {
  const apiKey = await resolveLoopbackKey(c);

  // Loopback target: when running on Railway the public hostname is fine, but
  // hitting localhost saves a network hop. Configurable via MCP_LOOPBACK_BASE.
  const loopbackBaseUrl =
    process.env["MCP_LOOPBACK_BASE"] ??
    `http://127.0.0.1:${process.env["PORT"] ?? "3000"}`;

  // Stateless mode: omit sessionIdGenerator entirely. Each request gets its
  // own server + transport pair. No SSE persistence, no session table.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  const server = buildServer(apiKey, loopbackBaseUrl);
  await server.connect(transport);

  // The Web Standard transport takes a Request and returns a Response.
  // Hono's c.req.raw is exactly that, so the bridge is one line.
  const response = await transport.handleRequest(c.req.raw);
  return response;
});
