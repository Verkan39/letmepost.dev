# @letmepost/mcp

MCP server for [letmepost.dev](https://letmepost.dev). Lets AI agents publish to Bluesky, X, LinkedIn, Threads, Instagram, Facebook, and Pinterest through a single tool call.

## Install

```sh
npx @letmepost/mcp
```

Or wire it into Claude Code:

```sh
claude mcp add letmepost npx @letmepost/mcp --env LMP_API_KEY=lmp_live_...
```

Cursor / Cline / any MCP client:

```json
{
  "mcpServers": {
    "letmepost": {
      "command": "npx",
      "args": ["@letmepost/mcp"],
      "env": { "LMP_API_KEY": "lmp_live_..." }
    }
  }
}
```

## Configuration

| Variable        | Required | Default                          | Description                                       |
| --------------- | -------- | -------------------------------- | ------------------------------------------------- |
| `LMP_API_KEY`   | yes      | —                                | Bearer token from https://dashboard.letmepost.dev |
| `LMP_API_BASE`  | no       | `https://api.letmepost.dev`      | Override for self-hosted deployments              |

## Tools

### `publish_post`

Publishes to one or more connected accounts in a single call. Returns a batch envelope with per-target results. Errors include the rule that broke, the raw platform response, and a remediation hint.

```json
{
  "text": "Shipping the MCP server today.",
  "targets": [
    { "platform": "twitter" },
    { "platform": "bluesky" }
  ]
}
```

### `list_accounts`

Lists the connected accounts visible to this API key. Optional `platform` filter.

## Self-host

Self-host bypasses every platform approval gate. Bring your own credentials, every platform works the day you clone the repo. See [docs.letmepost.dev/self-host/quick-start](https://docs.letmepost.dev/self-host/quick-start).

## License

Apache 2.0.
