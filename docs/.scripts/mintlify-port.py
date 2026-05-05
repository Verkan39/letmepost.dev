#!/usr/bin/env python3
"""
One-off transformer that ports lmp/ Astro MDX into Mintlify MDX.

Run from the docs/ root:
    python3 .scripts/mintlify-port.py

Idempotent — safe to re-run; transforms what's there now.

What it does:
  1. Strips Astro-only frontmatter fields (section, order, code, httpStatus,
     retryable, rule, platform, event, stub, sourceFile).
  2. Removes top-of-file `import` lines that referenced Astro components.
  3. Replaces <CodeWindow filename="..." lang="..." code={`...`} /> with a
     Mintlify fenced code block: ```<lang> <filename>\n...\n```.
  4. Rewrites internal links:
       /docs/idempotency/        ->  /idempotency
       /docs/errors/foo/         ->  /errors/foo
       /docs/preflight/foo/      ->  /preflight/foo
       /docs/platforms/foo/      ->  /platforms/foo
       /docs/webhooks/foo/       ->  /webhooks/foo
       /api/                     ->  /api-reference
       /api/...                  ->  /api-reference/...
"""
from pathlib import Path
import re
import sys

DOCS = Path(__file__).resolve().parent.parent

ASTRO_FM_FIELDS = {
    "section", "order", "code", "httpStatus", "retryable",
    "rule", "platform", "event", "stub", "sourceFile",
}

CODEWINDOW_RE = re.compile(
    r'<CodeWindow\s+'                       # opening tag
    r'(?:filename="(?P<filename>[^"]*)"\s+)?'
    r'lang="(?P<lang>[^"]+)"\s+'
    r'code=\{`(?P<code>.*?)`\}\s*'
    r'/>',
    re.DOTALL,
)

# Mintlify fences accept the language token and a free-form title after it.
def replace_codewindow(match: re.Match) -> str:
    filename = match.group("filename") or ""
    lang = match.group("lang")
    code = match.group("code")
    # Mintlify is happy with bash, ts, js, json, python, go etc. Map common.
    lang_map = {"ts": "ts", "js": "js", "javascript": "js", "typescript": "ts",
                "bash": "bash", "shell": "bash", "sh": "bash",
                "python": "python", "py": "python", "go": "go", "json": "json",
                "yaml": "yaml", "yml": "yaml", "html": "html", "css": "css"}
    lang = lang_map.get(lang.lower(), lang.lower())
    title = f" {filename}" if filename else ""
    return f"```{lang}{title}\n{code}\n```"

LINK_REWRITES = [
    # Drop the /docs/ prefix; Mintlify is mounted at the docs root.
    (re.compile(r"\(/docs/([^)]*)\)"), lambda m: f"({_strip_trailing_slash('/' + m.group(1))})"),
    # /api/ -> /api-reference
    (re.compile(r"\(/api/([^)]*)\)"), lambda m: f"(/api-reference/{m.group(1).rstrip('/')})" if m.group(1) else "(/api-reference)"),
    (re.compile(r"\(/api\)"), lambda m: "(/api-reference)"),
]

def _strip_trailing_slash(path: str) -> str:
    if path.endswith("/") and len(path) > 1:
        return path[:-1]
    return path

def transform_frontmatter(text: str) -> str:
    """Strip Astro-only fields. Preserve everything else."""
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    fm = text[4:end]
    rest = text[end + 5 :]

    kept = []
    for line in fm.split("\n"):
        if not line:
            kept.append(line)
            continue
        m = re.match(r"^(\w+):", line)
        if m and m.group(1) in ASTRO_FM_FIELDS:
            continue
        kept.append(line)
    return "---\n" + "\n".join(kept).strip("\n") + "\n---\n" + rest

_ASTRO_IMPORT = re.compile(
    r'^\s*import\s+.+?\s+from\s+["\'][^"\']*(?:\.astro|astro:components|@/components|/components/)[^"\']*["\']\s*;?\s*$',
    re.MULTILINE,
)

def remove_imports(text: str) -> str:
    """Drop import lines that pulled in Astro components, anywhere in the file."""
    text = _ASTRO_IMPORT.sub("", text)
    # Collapse the blank gap left behind so we don't have 3+ consecutive blanks.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text

def transform(text: str) -> str:
    text = transform_frontmatter(text)
    text = remove_imports(text)
    text = CODEWINDOW_RE.sub(replace_codewindow, text)
    for pattern, repl in LINK_REWRITES:
        text = pattern.sub(repl, text)
    return text

def process_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    new = transform(original)
    if new != original:
        path.write_text(new, encoding="utf-8")
        return True
    return False

def main() -> None:
    targets: list[Path] = []
    for sub in ("", "errors", "preflight", "platforms", "webhooks", "guides", "sdks"):
        d = DOCS / sub if sub else DOCS
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.mdx")):
            targets.append(p)

    changed = 0
    for p in targets:
        if process_file(p):
            print(f"  ✓ {p.relative_to(DOCS)}")
            changed += 1
    print(f"\nTransformed {changed}/{len(targets)} files.")

if __name__ == "__main__":
    main()
