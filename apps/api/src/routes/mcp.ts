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
import { Hono } from "hono";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AutogenTool,
  loadAutogenTools,
} from "@letmepost/mcp/autogen";

import { apiKeyAuth } from "../middleware/api-key.js";

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

mcp.post("/", apiKeyAuth(), async (c) => {
  const authHeader = c.req.header("Authorization") ?? "";
  const apiKey = authHeader.slice("Bearer ".length).trim();

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
