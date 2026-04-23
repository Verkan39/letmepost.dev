import { LetmepostError } from "../../errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PlatformRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** If an object is given, it is JSON.stringified and Content-Type is set. */
  body?: unknown;
  /** Abort after N ms. Defaults to 30_000. */
  timeoutMs?: number;
  /** Platform name for error context (e.g. "bluesky", "linkedin"). */
  platform: string;
}

export interface PlatformResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Headers;
  /** Parsed JSON body, or `undefined` if the response was empty / not JSON. */
  body: T | undefined;
  /** Raw response text when JSON parsing failed; `null` otherwise. */
  raw: string | null;
}

async function parseBody(
  res: Response,
): Promise<{ body: unknown; raw: string | null }> {
  const text = await res.text();
  if (!text) return { body: undefined, raw: null };
  try {
    return { body: JSON.parse(text) as unknown, raw: null };
  } catch {
    return { body: undefined, raw: text };
  }
}

/**
 * Thin wrapper around fetch for outbound platform calls.
 *
 * Non-goals:
 * - Does NOT throw on 4xx/5xx. The caller decides how to classify (auth vs
 *   rejected vs rate-limited) because upstream semantics vary by platform.
 *
 * Throws:
 * - `LetmepostError("platform_unavailable")` on network failure or timeout.
 */
export async function platformFetch<T = unknown>(
  req: PlatformRequest,
): Promise<PlatformResponse<T>> {
  const headers: Record<string, string> = { ...req.headers };
  let body: string | undefined;
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      body = req.body;
    } else {
      headers["Content-Type"] ??= "application/json";
      body = JSON.stringify(req.body);
    }
  }

  const signal = AbortSignal.timeout(req.timeoutMs ?? 30_000);

  try {
    const init: RequestInit = { method: req.method, headers, signal };
    if (body !== undefined) init.body = body;
    const res = await fetch(req.url, init);
    const parsed = await parseBody(res);
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      body: parsed.body as T | undefined,
      raw: parsed.raw,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    throw new LetmepostError({
      code: "platform_unavailable",
      status: 503,
      message: isTimeout
        ? `Upstream ${req.platform} request timed out.`
        : `Failed to reach ${req.platform}.`,
      platform: req.platform,
      remediation:
        "The upstream platform may be unreachable or unresponsive; retry the request shortly.",
    });
  }
}
