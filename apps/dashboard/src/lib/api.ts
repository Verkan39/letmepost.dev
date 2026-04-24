import { API_URL } from "./env";

/**
 * Thin fetch wrapper for the letmepost HTTP API. Every call includes
 * `credentials: "include"` so better-auth's session cookie travels
 * cross-origin (dashboard on :3001, API on :3000), and unpacks the error
 * contract into a typed throwable so callers can show a real message instead
 * of "Something went wrong."
 */

export type ApiError = {
  code: string;
  message: string;
  rule?: string;
  platform?: string;
  platformResponse?: unknown;
  remediation?: string;
  requestId?: string;
  traceId?: string;
  status: number;
};

export class ApiRequestError extends Error {
  readonly payload: ApiError;
  constructor(payload: ApiError) {
    super(payload.message);
    this.payload = payload;
    this.name = "ApiRequestError";
  }
}

type RequestOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** When true, do not throw on non-2xx — return the parsed error instead. */
  returnErrorAsResult?: boolean;
};

export async function apiFetch<T>(
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.headers ?? {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const body = (parsed ?? {}) as Record<string, unknown>;
    const err: ApiError = {
      code: (body.code as string | undefined) ?? "unknown_error",
      message:
        (body.message as string | undefined) ??
        `Request failed with status ${res.status}`,
      rule: body.rule as string | undefined,
      platform: body.platform as string | undefined,
      platformResponse: body.platformResponse,
      remediation: body.remediation as string | undefined,
      requestId: body.requestId as string | undefined,
      traceId: body.traceId as string | undefined,
      status: res.status,
    };
    throw new ApiRequestError(err);
  }

  return parsed as T;
}
