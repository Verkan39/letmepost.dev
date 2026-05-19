import kleur from "kleur";
import { apiFetch, CliError, failWithApiError } from "../client.js";
import {
  readDefaultProfileId,
  writeDefaultProfileId,
} from "../config.js";
import { formatDate, renderTable } from "../format.js";

/**
 * `/v1/profiles` row as returned by the API today. `isDefault` is optional —
 * the field hasn't shipped yet but the column is reserved in the CLI table so
 * we don't have to re-cut the surface when it lands.
 */
type Profile = {
  id: string;
  name: string;
  slug?: string;
  createdAt: string;
  updatedAt?: string;
  isDefault?: boolean;
};

type ProfilesListResponse = { data: Profile[] };

/**
 * `lmp profiles list` — table of every profile in the active org.
 *
 * No profile scoping on this call: the listing is org-wide and the API ignores
 * any `profileId` query param it might receive.
 */
export async function runProfilesList(): Promise<void> {
  const result = await apiFetch<ProfilesListResponse>("/v1/profiles");
  if (!result.ok) failWithApiError(result);

  const rows = result.body.data;
  if (rows.length === 0) {
    process.stdout.write(
      "No profiles yet. Create one at https://dashboard.letmepost.dev/profiles.\n",
    );
    return;
  }

  const tableRows = rows.map((p) => [
    p.id,
    p.name,
    formatDate(p.createdAt),
    p.isDefault ? "yes" : "",
  ]);
  process.stdout.write(
    `${renderTable(["ID", "NAME", "CREATED_AT", "IS_DEFAULT"], tableRows)}\n`,
  );
}

/**
 * `lmp profiles use <id>` — persist the default profile to ~/.letmepost/config.json.
 *
 * Validates the id by listing profiles first so we fail fast on a typo (and so
 * we never write an id that nothing in the org actually owns).
 */
export async function runProfilesUse(id: string): Promise<void> {
  const trimmed = id.trim();
  if (!trimmed) throw new CliError("Profile id is required.");

  const result = await apiFetch<ProfilesListResponse>("/v1/profiles");
  if (!result.ok) failWithApiError(result);
  const match = result.body.data.find((p) => p.id === trimmed);
  if (!match) {
    throw new CliError(
      `Profile "${trimmed}" not found in this org. Run \`lmp profiles list\` to see the available ids.`,
    );
  }

  writeDefaultProfileId(match.id);
  process.stdout.write(
    `${kleur.green("✔")} Default profile set to ${match.name} (${match.id}).\n`,
  );
}

/**
 * `lmp profiles current` — print the persisted default profile id, or the
 * "none" sentinel when scoping is unset.
 */
export function runProfilesCurrent(): void {
  const id = readDefaultProfileId();
  if (!id) {
    process.stdout.write("none — using key default\n");
    return;
  }
  process.stdout.write(`${id}\n`);
}
