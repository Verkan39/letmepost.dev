#!/usr/bin/env node
// Copies the canonical OpenAPI doc into the locations the runtime expects.
//
// We need the spec next to the compiled JS (so the published bin can read it
// without depending on the repo layout) AND next to the source (so `tsx
// watch` and dev mode work without a separate build). Both targets are
// written from one source of truth: docs/api-reference/openapi.json.

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
];

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

console.log(`[copy-openapi] ${source} -> ${targets.length} target(s)`);
