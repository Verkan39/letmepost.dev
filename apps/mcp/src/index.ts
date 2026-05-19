#!/usr/bin/env node

// stdio MCP server. Loads the OpenAPI spec that ships with this package and
// projects every documented operation into a tool. The same projection runs
// inside the hosted /mcp route — see apps/mcp/src/autogen.ts for the
// implementation.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadConfig } from "./client.js";
import { type AutogenTool, loadAutogenTools } from "./autogen.js";

const SERVER_NAME = "letmepost";
const SERVER_VERSION = "0.2.0";

const config = loadConfig();

// The build step copies openapi.json next to this file so it ships with the
// published bin. In dev we run via tsx out of src/, so the same relative
// path works there too (the prebuild script writes both).
const here = dirname(fileURLToPath(import.meta.url));
const specPath = join(here, "openapi.json");

const tools = loadAutogenTools(specPath);
const toolIndex = new Map<string, AutogenTool>(tools.map((t) => [t.name, t]));

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
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
    const result = await tool.execute((args as Record<string, unknown>) ?? {}, {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
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

const transport = new StdioServerTransport();
await server.connect(transport);

// stderr stays available for diagnostic output. stdout is reserved for the
// MCP protocol so anything printed there will corrupt the framing.
process.stderr.write(
  `[letmepost-mcp] connected (base=${config.baseUrl}, tools=${tools.length})\n`,
);
