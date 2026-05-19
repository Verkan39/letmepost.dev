import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { AddressInfo } from "node:net";
import open from "open";
import kleur from "kleur";
import { CliError } from "../client.js";
import {
  defaultBaseUrl,
  readConfig,
  writeConfig,
  type StoredConfig,
} from "../config.js";

/**
 * `lmp login` — PKCE OAuth flow with a fallback to API-key paste.
 *
 * Flow:
 *   1. Ensure we have a client_id (dynamic registration, cached on disk).
 *   2. Start a local HTTP listener on a random free port.
 *   3. Open the browser at /oauth2/authorize with the PKCE challenge.
 *   4. Wait for the redirect to /callback, validate state, exchange code → token.
 *   5. Persist the access (+ refresh) token to ~/.letmepost/config.json.
 *
 * When any of /oauth2/register, /oauth2/authorize, /oauth2/token returns 404
 * we drop straight into "paste your API key" mode — the OAuth provider is
 * being shipped by a parallel agent and may not be live yet.
 */
export async function runLogin(): Promise<void> {
  const baseUrl = defaultBaseUrl();

  // Probe OAuth metadata first. If the discovery / authorize endpoint isn't
  // there, fall back to API-key paste without forcing the user to click through.
  const oauthAvailable = await detectOAuth(baseUrl);
  if (!oauthAvailable) {
    process.stdout.write(
      kleur.yellow(
        "OAuth not yet enabled. Falling back to API key.\n",
      ),
    );
    await runApiKeyLogin(baseUrl);
    return;
  }

  try {
    await runOAuthLogin(baseUrl);
  } catch (err) {
    if (err instanceof CliError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new CliError(`Login failed: ${message}`);
  }
}

async function detectOAuth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/oauth2/authorize`, { method: "GET" });
    // 404 → endpoint absent. Anything else (302, 400, 401) means it's wired up.
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function runApiKeyLogin(baseUrl: string): Promise<void> {
  process.stdout.write(
    "Paste your API key from https://dashboard.letmepost.dev/api-keys:\n",
  );
  const rl = createInterface({ input: stdin, output: stdout });
  let token: string;
  try {
    token = (await rl.question("> ")).trim();
  } finally {
    rl.close();
  }
  if (!token) throw new CliError("No API key entered.");

  // Sanity check the token by hitting /v1/accounts. A 401 here means the user
  // pasted something that doesn't work; better to fail fast than to write a
  // dead token to disk.
  const probe = await fetch(`${baseUrl}/v1/accounts`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (probe.status === 401 || probe.status === 403) {
    throw new CliError(
      "API key rejected by the server. Generate a new one in the dashboard.",
    );
  }

  const existing = readConfig();
  const next: StoredConfig = {
    ...(existing ?? {}),
    accessToken: token,
    baseUrl,
  };
  writeConfig(next);
  process.stdout.write(`${kleur.green("✔")} Saved API key to ~/.letmepost/config.json\n`);
}

async function runOAuthLogin(baseUrl: string): Promise<void> {
  const clientId = await getOrRegisterClient(baseUrl);
  const port = await startCallbackServer();
  const redirectUri = `http://localhost:${port.port}/callback`;
  const state = randomBytes(16).toString("hex");
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());

  const authorizeUrl = new URL(`${baseUrl}/oauth2/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "publish read offline_access");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  process.stdout.write(
    `Opening your browser to authorize the CLI...\nIf it doesn't open, visit:\n  ${authorizeUrl.toString()}\n`,
  );
  // open() may fail in headless shells (CI, ssh). That's fine — the URL
  // is already printed above.
  try {
    await open(authorizeUrl.toString());
  } catch {
    // headless — user can copy/paste.
  }

  let callback: CallbackResult;
  try {
    callback = await port.waitForCallback();
  } finally {
    port.close();
  }
  if (callback.state !== state) {
    throw new CliError("OAuth state mismatch — refusing to continue.");
  }
  if (callback.error) {
    throw new CliError(
      `Authorization rejected: ${callback.error}${
        callback.errorDescription ? ` — ${callback.errorDescription}` : ""
      }`,
    );
  }
  if (!callback.code) {
    throw new CliError("Authorization did not return a code.");
  }

  const tokenRes = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }).toString(),
  });
  const tokenBody = (await tokenRes.json().catch(() => null)) as
    | {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
      }
    | null;
  if (!tokenRes.ok || !tokenBody?.access_token) {
    throw new CliError(
      `Token exchange failed (HTTP ${tokenRes.status}): ${
        tokenBody ? JSON.stringify(tokenBody) : "no body"
      }`,
    );
  }

  const existing = readConfig();
  const next: StoredConfig = {
    ...(existing ?? {}),
    accessToken: tokenBody.access_token,
    baseUrl,
    clientId,
  };
  if (tokenBody.refresh_token) next.refreshToken = tokenBody.refresh_token;
  if (typeof tokenBody.expires_in === "number") {
    next.expiresAt = Date.now() + tokenBody.expires_in * 1000;
  }
  writeConfig(next);
  process.stdout.write(`${kleur.green("✔")} Logged in. Token saved to ~/.letmepost/config.json\n`);
}

/**
 * Reuse a cached client_id when we have one. Otherwise hit /oauth2/register
 * (dynamic client registration, RFC 7591) with the loopback redirect URI and
 * `token_endpoint_auth_method=none` (public client — no secret on disk).
 */
async function getOrRegisterClient(baseUrl: string): Promise<string> {
  const existing = readConfig();
  if (existing?.clientId) return existing.clientId;

  const res = await fetch(`${baseUrl}/oauth2/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "letmepost-cli",
      // Multiple loopback ports per RFC 8252 — we pick a free one at runtime.
      redirect_uris: ["http://localhost/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (!res.ok) {
    throw new CliError(
      `Dynamic client registration failed (HTTP ${res.status}). Re-run with LMP_CLIENT_ID set, or paste an API key via \`lmp login\` after the OAuth provider ships.`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as { client_id?: string };
  if (!body.client_id) {
    throw new CliError("Dynamic client registration returned no client_id.");
  }
  return body.client_id;
}

type CallbackResult = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

type CallbackHandle = {
  port: number;
  close(): void;
  waitForCallback(): Promise<CallbackResult>;
};

/** Start an HTTP listener on a random free port. Resolves once the OS assigns the port. */
async function startCallbackServer(): Promise<CallbackHandle> {
  let resolve: (value: CallbackResult) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const callback = new Promise<CallbackResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server: Server = createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("missing url");
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const params: CallbackResult = {};
    const code = url.searchParams.get("code");
    if (code) params.code = code;
    const state = url.searchParams.get("state");
    if (state) params.state = state;
    const error = url.searchParams.get("error");
    if (error) params.error = error;
    const desc = url.searchParams.get("error_description");
    if (desc) params.errorDescription = desc;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><meta charset="utf-8"><title>letmepost CLI</title>` +
        `<body style="font-family:system-ui;padding:2rem">` +
        `<h1>${params.error ? "Authorization failed" : "You're logged in"}</h1>` +
        `<p>You can close this tab and return to your terminal.</p>` +
        `</body>`,
    );
    resolve(params);
  });

  server.on("error", (err) => reject(err));

  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rej);
      res();
    });
  });

  const address = server.address() as AddressInfo;
  if (!address || typeof address.port !== "number") {
    server.close();
    throw new CliError("Could not bind a local port for the OAuth callback.");
  }

  return {
    port: address.port,
    close: () => server.close(),
    waitForCallback: () => callback,
  };
}

/** RFC 4648 §5 base64url, no padding. */
function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
