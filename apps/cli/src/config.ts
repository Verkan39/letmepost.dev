import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * On-disk config for the CLI. Lives at `~/.letmepost/config.json` with
 * mode 0700 on the parent dir. Holds whatever credential the user has —
 * an OAuth access token (preferred) or a pasted API key. We don't try to
 * tell them apart; both go in the `Authorization: Bearer …` header the
 * same way.
 */
export type StoredConfig = {
  accessToken: string;
  baseUrl: string;
  expiresAt?: number;
  refreshToken?: string;
  userId?: string;
  /** Client id minted by dynamic registration. Cached to avoid re-registering on every login. */
  clientId?: string;
};

const DEFAULT_BASE = "https://api.letmepost.dev";

export function configDir(): string {
  return join(homedir(), ".letmepost");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

/** Base URL used by every API call. Env override wins. */
export function defaultBaseUrl(): string {
  return (process.env.LMP_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, "");
}

/** Read the on-disk config. Returns null when the file doesn't exist. */
export function readConfig(): StoredConfig | null {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["accessToken"] !== "string") return null;
    return parsed as StoredConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Write the config atomically with restrictive perms on dir + file. */
export function writeConfig(config: StoredConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
  // mkdirSync ignores mode on existing dirs on some platforms; be explicit.
  // (No chmod needed for the file — writeFileSync sets mode on create.)
  void dirname(path);
}

/** Wipe the on-disk config entirely. */
export function deleteConfig(): boolean {
  try {
    rmSync(configPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the credential the CLI should send.
 *
 * Env wins so CI / agentic shells can override without touching disk:
 *   LMP_API_KEY  — token used directly as the Bearer value.
 *   LMP_API_BASE — overrides the base URL even if the stored config has one.
 */
export type ResolvedAuth = {
  token: string;
  baseUrl: string;
  source: "env" | "config";
};

export function resolveAuth(): ResolvedAuth | null {
  const envToken = process.env.LMP_API_KEY?.trim();
  if (envToken && envToken.length > 0) {
    return {
      token: envToken,
      baseUrl: defaultBaseUrl(),
      source: "env",
    };
  }
  const stored = readConfig();
  if (!stored) return null;
  const baseUrl = process.env.LMP_API_BASE
    ? defaultBaseUrl()
    : (stored.baseUrl ?? DEFAULT_BASE);
  return {
    token: stored.accessToken,
    baseUrl,
    source: "config",
  };
}
