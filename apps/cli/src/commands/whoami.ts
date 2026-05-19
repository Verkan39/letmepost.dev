import kleur from "kleur";
import { apiFetch, failWithApiError, requireAuth } from "../client.js";

/**
 * `whoami` confirms the stored credential authenticates and surfaces enough
 * context for an agent / user to understand which environment they're hitting.
 *
 * The API has no dedicated `/v1/me` endpoint, so we lean on `GET /v1/accounts`
 * — it 401s on a bad token and otherwise tells us how many accounts the key
 * can see. Combined with the base URL + token prefix, that's enough to make
 * the right decision before publishing.
 */
type AccountListResponse = {
  data: Array<{ id: string; platform: string; displayName: string | null }>;
};

export async function runWhoami(): Promise<void> {
  const auth = requireAuth();
  const result = await apiFetch<AccountListResponse>("/v1/accounts");
  if (!result.ok) failWithApiError(result);

  const masked = maskToken(auth.token);
  process.stdout.write(`${kleur.bold("api")}     ${auth.baseUrl}\n`);
  process.stdout.write(`${kleur.bold("token")}   ${masked} (${auth.source})\n`);
  process.stdout.write(
    `${kleur.bold("scope")}   ${result.body.data.length} connected account(s)\n`,
  );
}

/** Show the prefix + last 4 of a token so the user can match it to a key, never the secret. */
function maskToken(token: string): string {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
