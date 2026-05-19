import { renderApiError, type ApiErrorBody } from "./format.js";
import { resolveAuth, type ResolvedAuth } from "./config.js";

/**
 * Per-call result. We surface status + parsed body separately so commands
 * can branch on shape rather than re-stringify and re-parse.
 */
export type ApiResult<T> =
  | { ok: true; status: number; body: T; requestId?: string }
  | { ok: false; status: number; body: unknown; requestId?: string };

export class CliError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** Pull credentials or throw a helpful error if the user hasn't logged in. */
export function requireAuth(): ResolvedAuth {
  const auth = resolveAuth();
  if (!auth) {
    throw new CliError(
      "Not logged in. Run `lmp login`, or set LMP_API_KEY in your environment.",
    );
  }
  return auth;
}

function newIdempotencyKey(): string {
  // Available on every Node >=18.
  return globalThis.crypto.randomUUID();
}

export type ApiFetchInit = RequestInit & {
  idempotencyKey?: string;
  /** Override the resolved auth (used by the login flow before persisting). */
  auth?: ResolvedAuth;
};

/**
 * Thin fetch wrapper that:
 *   1. Resolves the bearer token + base URL once.
 *   2. Stamps Idempotency-Key on every non-GET (the API requires it on POST /v1/posts).
 *   3. Parses JSON bodies; falls back to raw text when the server returns HTML.
 *   4. Returns the structured ApiResult so callers can pattern-match without try/catch.
 */
export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<ApiResult<T>> {
  const auth = init.auth ?? requireAuth();
  const url = `${auth.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${auth.token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if ((init.method ?? "GET") !== "GET" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", init.idempotencyKey ?? newIdempotencyKey());
  }
  const { auth: _ignored, idempotencyKey: _ig2, ...rest } = init;
  void _ignored;
  void _ig2;

  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Request to ${url} failed: ${message}`);
  }
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const text = await res.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      // Leave body as raw text — surfacing it helps debug a misconfigured base URL.
    }
  }
  if (res.ok) {
    return requestId
      ? { ok: true, status: res.status, body: body as T, requestId }
      : { ok: true, status: res.status, body: body as T };
  }
  return requestId
    ? { ok: false, status: res.status, body, requestId }
    : { ok: false, status: res.status, body };
}

/**
 * Print a structured API error to stderr and throw CliError so commander
 * exits non-zero. Falls back to a generic message when the body doesn't
 * match the envelope shape (e.g. a raw HTML 502 from an edge proxy).
 */
export function failWithApiError(result: {
  status: number;
  body: unknown;
  requestId?: string;
}): never {
  const envelope = asApiErrorBody(result.body, result.requestId);
  if (envelope) {
    process.stderr.write(`${renderApiError(envelope)}\n`);
    throw new CliError("", 1);
  }
  // Non-envelope error — render what we got so the user can debug.
  const tail =
    typeof result.body === "string"
      ? result.body
      : JSON.stringify(result.body, null, 2);
  throw new CliError(
    `API returned HTTP ${result.status}${result.requestId ? ` (requestId=${result.requestId})` : ""}: ${tail}`,
  );
}

function asApiErrorBody(
  body: unknown,
  requestIdFallback: string | undefined,
): ApiErrorBody | null {
  if (!body || typeof body !== "object") return null;
  const maybe = body as { error?: unknown };
  if (!maybe.error || typeof maybe.error !== "object") return null;
  const err = maybe.error as Record<string, unknown>;
  if (typeof err["code"] !== "string" || typeof err["message"] !== "string") {
    return null;
  }
  // Backfill requestId from the response header when the body omits it.
  if (typeof err["requestId"] !== "string" && requestIdFallback) {
    err["requestId"] = requestIdFallback;
  }
  return { error: err as ApiErrorBody["error"] };
}
