const DEFAULT_BASE = "https://api.letmepost.dev";

export type ClientConfig = {
  apiKey: string;
  baseUrl: string;
};

export function loadConfig(): ClientConfig {
  const apiKey = process.env.LMP_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LMP_API_KEY is not set. Generate one at https://dashboard.letmepost.dev and export it before launching the MCP server.",
    );
  }
  return {
    apiKey,
    baseUrl: (process.env.LMP_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

function newIdempotencyKey(): string {
  // crypto.randomUUID is on every Node >=18 LTS.
  return globalThis.crypto.randomUUID();
}

export type ApiResponse<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: unknown };

export async function apiFetch<T>(
  config: ClientConfig,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<ApiResponse<T>> {
  const url = `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.apiKey}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if ((init.method ?? "GET") !== "GET" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", init.idempotencyKey ?? newIdempotencyKey());
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON response (HTML error pages from a misconfigured base URL,
      // edge timeouts). Surface raw text so the agent can read it.
    }
  }
  return res.ok
    ? { ok: true, status: res.status, body: body as T }
    : { ok: false, status: res.status, body };
}
