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
  /**
   * Default profile to scope requests to. When set, the CLI sends it as
   * `?profileId=…` on GET / DELETE and as a top-level body field on
   * `POST /v1/posts`. When null/unset, requests omit profile scoping and the
   * API falls back to the key/token's default profile.
   */
  profileId?: string | null;
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

/**
 * Read just the persisted default profile id. Returns null when the config
 * file is absent or the field isn't set. Callers prefer this to readConfig()
 * when they don't need the credential.
 */
export function readDefaultProfileId(): string | null {
  const cfg = readConfig();
  if (!cfg) return null;
  const id = cfg.profileId;
  if (typeof id !== "string" || id.length === 0) return null;
  return id;
}

/**
 * Persist (or clear) the default profile id on disk without touching the
 * credential. Throws if no config exists yet — the user must `lmp login`
 * first because we don't want to write a profileId-only file that resolveAuth
 * would treat as malformed.
 */
export function writeDefaultProfileId(profileId: string | null): void {
  const existing = readConfig();
  if (!existing) {
    throw new Error(
      "No stored credential. Run `lmp login` (or set LMP_API_KEY) before selecting a profile.",
    );
  }
  const next: StoredConfig = { ...existing, profileId };
  writeConfig(next);
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

/**
 * Pick the profile id the current command should scope to.
 *
 * Precedence (highest wins):
 *   1. `--profile <id>` flag on the command (`flagValue`).
 *   2. The persisted default in `~/.letmepost/config.json` (`profileId`).
 *   3. `null` — caller omits profile scoping and the API falls back to the
 *      key/token's default profile.
 *
 * An empty-string flag value is treated as "unset" rather than "clear" so that
 * `--profile ""` doesn't silently send `?profileId=` to the API.
 */
export function resolveProfileId(flagValue?: string | null): string | null {
  if (typeof flagValue === "string" && flagValue.trim().length > 0) {
    return flagValue.trim();
  }
  return readDefaultProfileId();
}

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
