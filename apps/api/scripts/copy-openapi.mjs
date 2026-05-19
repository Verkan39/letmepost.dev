#!/usr/bin/env node
// Mirror the canonical OpenAPI doc into apps/api so the hosted /mcp route can
// read it at runtime without depending on the repo layout. Same pattern as
// apps/mcp/scripts/copy-openapi.mjs.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(here);
const repoRoot = dirname(dirname(pkgRoot));

const source = join(repoRoot, "docs", "api-reference", "openapi.json");
if (!existsSync(source)) {
  console.error(`[copy-openapi] source missing: ${source}`);
  process.exit(1);
}

const targets = [
  join(pkgRoot, "src", "openapi.json"),
  join(pkgRoot, "dist", "openapi.json"),
  // Hosted MCP route reads from the route's compiled folder.
  join(pkgRoot, "dist", "routes", "openapi.json"),
  join(pkgRoot, "src", "routes", "openapi.json"),
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

console.log(`[copy-openapi] ${source} -> ${targets.length} target(s)`);
