import kleur from "kleur";

/**
 * Tiny pure-ASCII table renderer. Two-space gutters between columns,
 * a single dash underline beneath the header row. Designed to be easy
 * to scrape with `awk '{print $1}'` from a shell pipeline.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > max) max = cell.length;
    }
    return max;
  });

  const pad = (cells: string[]) =>
    cells
      .map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();

  const header = pad(headers);
  const underline = widths.map((w) => "-".repeat(w)).join("  ").trimEnd();
  const body = rows.map(pad).join("\n");
  return body.length > 0
    ? `${kleur.bold(header)}\n${kleur.gray(underline)}\n${body}`
    : `${kleur.bold(header)}\n${kleur.gray(underline)}`;
}

/** Format an ISO-8601 datetime as `YYYY-MM-DD HH:MM` UTC. Empty input → "". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Stable shape for API error envelopes. Mirrors the API's `ApiError` schema
 * (see docs/api-reference/openapi.json). Every field except `code` and
 * `message` is optional.
 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    rule?: string;
    platform?: string;
    platformVersion?: string;
    platformResponse?: unknown;
    remediation?: string;
    docUrl?: string;
    ruleUrl?: string;
    requestId?: string;
    traceId?: string;
  };
};

/**
 * Pretty-print a structured API error envelope.
 *
 * Layout (kept ASCII so it survives non-color terminals):
 *
 *   ✗ failed
 *     code:        preflight_failed
 *     rule:        bluesky.text.max_graphemes
 *     message:     Bluesky posts are capped at 300 graphemes; this body is 312.
 *     remediation: Trim 12 graphemes, or split into a thread.
 *     docs:        https://docs.letmepost.dev/preflight/bluesky-text-max_graphemes
 *     requestId:   req_01HY6X4AWBJM2K9F2PTQMRD9JQ
 */
export function renderApiError(body: ApiErrorBody): string {
  const e = body.error;
  const lines: string[] = [];
  lines.push(kleur.red().bold("✗ failed"));
  const kv = (label: string, value: string | undefined) => {
    if (!value) return;
    lines.push(`  ${label.padEnd(12)} ${value}`);
  };
  kv("code:", e.code);
  if (e.rule) kv("rule:", e.rule);
  if (e.platform) kv("platform:", e.platform);
  kv("message:", e.message);
  if (e.remediation) kv("remediation:", e.remediation);
  const docs = e.ruleUrl ?? e.docUrl;
  if (docs) kv("docs:", docs);
  if (e.requestId) lines.push(kleur.gray(`  requestId:   ${e.requestId}`));
  return lines.join("\n");
}

/** Style a "published to X" success line. */
export function renderTargetSuccess(platform: string, uri?: string): string {
  const tail = uri ? ` — ${uri}` : "";
  return `${kleur.green("✔")} published to ${platform}${tail}`;
}

/** Style a "failed on X" failure line for a per-target result. */
export function renderTargetFailure(
  platform: string,
  err: {
    code?: string;
    rule?: string;
    message?: string;
    remediation?: string;
  },
): string {
  const lines: string[] = [];
  lines.push(`${kleur.red("✗")} failed on ${platform}`);
  if (err.rule) lines.push(`  rule: ${err.rule}`);
  else if (err.code) lines.push(`  code: ${err.code}`);
  if (err.message) lines.push(`  message: ${err.message}`);
  if (err.remediation) lines.push(`  remediation: ${err.remediation}`);
  return lines.join("\n");
}
