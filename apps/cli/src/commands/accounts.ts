import kleur from "kleur";
import { apiFetch, failWithApiError } from "../client.js";
import { formatDate, renderTable } from "../format.js";

type Account = {
  id: string;
  platform: string;
  platformAccountId: string;
  displayName: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AccountListResponse = { data: Account[] };

export type AccountsListOptions = {
  platform?: string;
};

/**
 * `lmp accounts list` — table of connected accounts. Filters client-side
 * because the API list endpoint doesn't expose a `platform` query yet.
 */
export async function runAccountsList(
  options: AccountsListOptions,
): Promise<void> {
  const result = await apiFetch<AccountListResponse>("/v1/accounts");
  if (!result.ok) failWithApiError(result);

  let rows = result.body.data;
  if (options.platform) {
    const wanted = options.platform.toLowerCase();
    rows = rows.filter((a) => a.platform === wanted);
  }

  if (rows.length === 0) {
    process.stdout.write(
      "No connected accounts. Connect one at https://dashboard.letmepost.dev/accounts.\n",
    );
    return;
  }

  const tableRows = rows.map((a) => [
    a.id,
    a.platform,
    a.displayName ?? a.platformAccountId,
    formatDate(a.createdAt),
  ]);
  process.stdout.write(
    `${renderTable(["ID", "PLATFORM", "HANDLE", "CONNECTED"], tableRows)}\n`,
  );
}

/**
 * `lmp accounts disconnect <id>` — DELETE /v1/accounts/:id.
 *
 * The API restricts disconnect to dashboard sessions (programmatic keys 401),
 * so we surface the error envelope verbatim when that happens.
 */
export async function runAccountsDisconnect(id: string): Promise<void> {
  const result = await apiFetch<{ id: string; deleted: boolean }>(
    `/v1/accounts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!result.ok) failWithApiError(result);
  process.stdout.write(`${kleur.green("✔")} disconnected ${id}\n`);
}
