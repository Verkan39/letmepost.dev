#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

import { loadConfig } from "./client.js";
import {
  PublishPostInputSchema,
  runPublishPost,
} from "./tools/publish_post.js";
import {
  ListAccountsInputSchema,
  runListAccounts,
} from "./tools/list_accounts.js";

const SERVER_NAME = "letmepost";
const SERVER_VERSION = "0.1.0";

const config = loadConfig();

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "publish_post",
      description:
        "Publish a post to one or more connected social platforms (Bluesky, X, LinkedIn, Threads, Instagram, Facebook, Pinterest). One call fans out to every target. Returns a batch envelope with per-target { status, postId, uri, error }. Errors include the rule that broke, the raw platform response, and a remediation hint so the agent can recover.",
      inputSchema: zodToJsonSchema(PublishPostInputSchema, {
        $refStrategy: "none",
      }) as Record<string, unknown>,
    },
    {
      name: "list_accounts",
      description:
        "List the connected social accounts visible to this API key. Use when you need an accountId for publish_post, or to confirm which platforms are connected before composing a multi-target call.",
      inputSchema: zodToJsonSchema(ListAccountsInputSchema, {
        $refStrategy: "none",
      }) as Record<string, unknown>,
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "publish_post") {
      const parsed = PublishPostInputSchema.parse(args ?? {});
      const body = await runPublishPost(config, parsed);
      return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
      };
    }
    if (name === "list_accounts") {
      const parsed = ListAccountsInputSchema.parse(args ?? {});
      const body = await runListAccounts(config, parsed);
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

const transport = new StdioServerTransport();
await server.connect(transport);

// stderr stays available for diagnostic output. stdout is reserved for the
// MCP protocol so anything printed there will corrupt the framing.
process.stderr.write(
  `[letmepost-mcp] connected (base=${config.baseUrl})\n`,
);
