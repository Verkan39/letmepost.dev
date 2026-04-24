import type { ApiKeyContext } from "./api-key.js";
import { LetmepostError } from "../errors.js";

/**
 * Checks that the api-key's profile scope (if any) permits acting on the
 * given account. Org-wide keys (`apiKey.profileId === null`) always pass;
 * profile-scoped keys must match the account's `profileId` exactly.
 *
 * Cross-profile access throws `not_found` (404), not `unauthorized` (403),
 * to avoid leaking the existence of the account to a key that shouldn't see
 * it.
 */
export function assertKeyCanAccessProfile(
  apiKey: Pick<ApiKeyContext, "profileId">,
  account: { profileId: string },
): void {
  if (apiKey.profileId === null) return;
  if (apiKey.profileId === account.profileId) return;
  throw new LetmepostError({
    code: "not_found",
    status: 404,
    message: "Platform account not found.",
    rule: "api_key.profile_scope",
  });
}
