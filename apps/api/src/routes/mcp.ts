// Hosted MCP endpoint at /mcp. Streamable HTTP transport, stateless mode.
//
// Auth: standard Authorization: Bearer lmp_live_... header. Every tool call
// uses the caller's API key — the same one they'd pass directly to /v1/*.
//
// Tool execution loops back over HTTP to this same instance. That keeps the
// code path identical to the stdio MCP server (apps/mcp): both shapes go
// through the public REST API, so all middleware (idempotency, rate limits,
// preflight, audit) runs uniformly. The loopback adds ~10ms which is in the
// noise next to upstream platform latency.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import { apiKeyAuth } from "../middleware/api-key.js";

const Platform = z.enum([
  "bluesky",
  "twitter",
  "linkedin",
  "threads",
  "instagram",
  "facebook",
  "pinterest",
]);

const Target = z.object({
  accountId: z
    .string()
    .optional()
    .describe(
      "Connected account id (e.g. acc_...). Omit to let the API resolve the org's single connected account for the given platform.",
    ),
  platform: Platform.optional().describe(
    "Platform name. Required if accountId is omitted; ignored otherwise.",
  ),
  text: z
    .string()
    .optional()
    .describe(
      "Per-target text override. Falls back to the top-level text if omitted.",
    ),
});

const PublishPostInput = z.object({
  text: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Default post text applied to every target that does not override it.",
    ),
  targets: z
    .array(Target)
    .min(1)
    .max(25)
    .describe(
      "One entry per destination. Each entry is either { accountId } or { platform }. Use { platform } when the org has a single connected account for that platform and you want the API to resolve it.",
    ),
  publishNow: z
    .boolean()
    .optional()
    .describe(
      "Defaults to true. Set false and provide scheduledAt to queue for later.",
    ),
  scheduledAt: z
    .string()
    .datetime()
    .optional()
    .describe("ISO-8601 datetime. Mutually exclusive with publishNow=true."),
});

const ListAccountsInput = z.object({
  platform: Platform.optional().describe(
    "Filter to a single platform. Omit to list every connected account on the org/profile scoped to this API key.",
  ),
});

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

async function callLoopback(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if ((init.method ?? "GET") !== "GET" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", init.idempotencyKey ?? newIdempotencyKey());
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  try {
    return text.length > 0 ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function buildServer(apiKey: string, loopbackBaseUrl: string): Server {
  const server = new Server(
    { name: "letmepost", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "publish_post",
        description:
          "Publish a post to one or more connected social platforms (Bluesky, X, LinkedIn, Threads, Instagram, Facebook, Pinterest). One call fans out to every target. Returns a batch envelope with per-target { status, postId, uri, error }. Errors include the rule that broke, the raw platform response, and a remediation hint so the agent can recover.",
        inputSchema: zodToJsonSchema(PublishPostInput, {
          $refStrategy: "none",
        }) as Record<string, unknown>,
      },
      {
        name: "list_accounts",
        description:
          "List the connected social accounts visible to this API key. Use when you need an accountId for publish_post, or to confirm which platforms are connected before composing a multi-target call.",
        inputSchema: zodToJsonSchema(ListAccountsInput, {
          $refStrategy: "none",
        }) as Record<string, unknown>,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      if (name === "publish_post") {
        const parsed = PublishPostInput.parse(args ?? {});
        const body = await callLoopback(loopbackBaseUrl, apiKey, "/v1/posts", {
          method: "POST",
          body: JSON.stringify(parsed),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        };
      }
      if (name === "list_accounts") {
        const parsed = ListAccountsInput.parse(args ?? {});
        const qs = parsed.platform ? `?platform=${parsed.platform}` : "";
        const body = await callLoopback(
          loopbackBaseUrl,
          apiKey,
          `/v1/accounts${qs}`,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
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

export const mcp = new Hono();

// CORS-style preflight for MCP clients that probe before the actual POST.
mcp.options("/", (c) =>
  c.body(null, 204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id",
  }),
);

mcp.post("/", apiKeyAuth(), async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const apiKey = authHeader.slice("Bearer ".length).trim();

  // Loopback target: when running on Railway the public hostname is fine, but
  // hitting localhost saves a network hop. Configurable via MCP_LOOPBACK_BASE.
  const loopbackBaseUrl =
    process.env.MCP_LOOPBACK_BASE ??
    `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

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
