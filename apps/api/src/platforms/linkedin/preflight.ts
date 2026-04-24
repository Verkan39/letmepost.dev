import { LINKEDIN_MAX_GRAPHEMES } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";
import {
  assertMaxGraphemes,
  assertNonEmpty,
} from "../_shared/preflight.js";

const PLATFORM = "linkedin";

/**
 * URN format LinkedIn expects on `posts.author`. Personal posts use
 * `urn:li:person:{id}`; org posts (post-MDP) use `urn:li:organization:{id}`.
 * Both `id` halves are alphanumeric+underscore on real LinkedIn data; we
 * stay liberal in the regex so we don't reject valid identifiers we haven't
 * seen — the actual server-side validation is on LinkedIn.
 */
const PERSON_URN_RE = /^urn:li:person:[A-Za-z0-9_-]+$/;
const ORGANIZATION_URN_RE = /^urn:li:organization:[A-Za-z0-9_-]+$/;

export interface LinkedInPublishInput {
  text: string;
  /** `urn:li:person:{id}` — derived from the connected account. */
  authorUrn: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}

export function validateLinkedInText(text: string): void {
  assertNonEmpty(text, {
    rule: "linkedin.text.non_empty",
    platform: PLATFORM,
  });
  assertMaxGraphemes(text, LINKEDIN_MAX_GRAPHEMES, {
    rule: "linkedin.text.max_graphemes",
    platform: PLATFORM,
  });
}

/**
 * Verify the URN is one of the two shapes LinkedIn accepts. Org URNs are
 * **out of MVP scope** (require MDP) — we surface a specific remediation
 * pointing the integrator at the post-MDP slice rather than letting the
 * upstream return a generic 422.
 */
export function validateLinkedInAuthor(authorUrn: string): void {
  if (PERSON_URN_RE.test(authorUrn)) return;
  if (ORGANIZATION_URN_RE.test(authorUrn)) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message:
        "Organization URNs require MDP-approved scopes; not in v1 personal-only MVP.",
      rule: "linkedin.author.org_not_supported",
      platform: PLATFORM,
      remediation:
        "Use a `urn:li:person:*` URN, or wait for the post-MDP follow-up slice that adds `w_organization_social`.",
    });
  }
  throw new LetmepostError({
    code: "preflight_failed",
    status: 400,
    message: `LinkedIn author URN is malformed: ${authorUrn}`,
    rule: "linkedin.author.urn_format",
    platform: PLATFORM,
    remediation:
      "Author URN must match `urn:li:person:{id}` (personal) or `urn:li:organization:{id}` (org, MDP-only).",
  });
}

export function validateLinkedInVisibility(value: string | undefined): void {
  if (value === undefined) return;
  if (value === "PUBLIC" || value === "CONNECTIONS") return;
  throw new LetmepostError({
    code: "preflight_failed",
    status: 400,
    message: `LinkedIn visibility must be PUBLIC or CONNECTIONS — got "${value}".`,
    rule: "linkedin.visibility.enum",
    platform: PLATFORM,
  });
}

export function validateLinkedInInput(input: LinkedInPublishInput): void {
  validateLinkedInText(input.text);
  validateLinkedInAuthor(input.authorUrn);
  validateLinkedInVisibility(input.visibility);
}
