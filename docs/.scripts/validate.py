#!/usr/bin/env python3
"""
Sanity-check docs.json + the file tree:
  1. Every page referenced by docs.json exists on disk.
  2. Every .mdx in the tree is referenced from docs.json (warn-only).
  3. Every internal markdown link points at a file that exists.
  4. The OpenAPI spec is valid JSON and has paths / components.
"""
import json
import re
from pathlib import Path
import sys

DOCS = Path(__file__).resolve().parent.parent
docs_json = json.loads((DOCS / "docs.json").read_text(encoding="utf-8"))

def collect_pages(node, out):
    """Walk only the `pages` arrays — `tab` and `group` are nav labels, not pages."""
    if isinstance(node, dict):
        if "pages" in node and isinstance(node["pages"], list):
            for entry in node["pages"]:
                if isinstance(entry, str):
                    out.add(entry)
                elif isinstance(entry, dict):
                    collect_pages(entry, out)
        if "groups" in node and isinstance(node["groups"], list):
            for g in node["groups"]:
                collect_pages(g, out)
        if "tabs" in node and isinstance(node["tabs"], list):
            for t in node["tabs"]:
                collect_pages(t, out)

referenced: set[str] = set()
collect_pages(docs_json.get("navigation", {}), referenced)

# 1. existence check
missing = []
for ref in sorted(referenced):
    candidate = DOCS / f"{ref}.mdx"
    if not candidate.exists():
        # Could be an auto-generated openapi page; tolerate api-reference/ paths.
        if ref.startswith("api-reference/"):
            continue
        missing.append(ref)
if missing:
    print("MISSING pages referenced by docs.json:")
    for m in missing:
        print(f"  - {m}.mdx")
else:
    print(f"✓ all {len(referenced)} pages referenced by docs.json exist")

# 2. unreferenced .mdx files (warn-only)
mdx_paths = set()
for p in DOCS.rglob("*.mdx"):
    if ".scripts" in p.parts:
        continue
    mdx_paths.add(str(p.relative_to(DOCS)).removesuffix(".mdx"))

unreferenced = mdx_paths - referenced
if unreferenced:
    print(f"\n⚠ {len(unreferenced)} pages on disk are NOT in docs.json nav:")
    for u in sorted(unreferenced):
        print(f"  - {u}")

# 3. internal link check — walk every .mdx, find markdown links to internal paths
LINK_RE = re.compile(r"\]\((/[^)]+)\)")
broken = []
for path in DOCS.rglob("*.mdx"):
    if ".scripts" in path.parts:
        continue
    text = path.read_text(encoding="utf-8")
    for m in LINK_RE.finditer(text):
        link = m.group(1)
        # ignore fragment-only / openapi spec / external static assets
        if "#" in link:
            link = link.split("#", 1)[0]
        if not link or link.startswith("/api-reference") or link.startswith("/llms.txt"):
            continue
        # ignore links to assets like /images/foo.svg
        if any(link.endswith(ext) for ext in (".svg", ".png", ".jpg", ".webp", ".json", ".yaml")):
            continue
        # strip trailing slash for matching
        target = link.lstrip("/").rstrip("/")
        # nav references like /errors map to errors/index.mdx OR errors.mdx
        candidates = [DOCS / f"{target}.mdx", DOCS / target / "index.mdx"]
        if not any(c.exists() for c in candidates):
            broken.append((path.relative_to(DOCS), link))

if broken:
    print(f"\n✗ {len(broken)} broken internal links:")
    for src, link in broken[:30]:
        print(f"  {src}: {link}")
    if len(broken) > 30:
        print(f"  ... and {len(broken) - 30} more")
else:
    print("\n✓ no broken internal links")

# 4. OpenAPI spec
spec_path = DOCS / "api-reference" / "openapi.json"
if not spec_path.exists():
    print(f"\n✗ OpenAPI spec missing at {spec_path}")
    sys.exit(1)
spec = json.loads(spec_path.read_text(encoding="utf-8"))
n_paths = len(spec.get("paths", {}))
n_schemas = len(spec.get("components", {}).get("schemas", {}))
print(f"\n✓ OpenAPI spec: {n_paths} paths, {n_schemas} schemas")

if missing or broken:
    sys.exit(1)
