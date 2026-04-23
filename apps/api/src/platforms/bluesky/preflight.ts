import { BLUESKY_MAX_GRAPHEMES } from "@letmepost/schemas";
import {
  assertMaxGraphemes,
  assertNonEmpty,
  countGraphemes,
} from "../_shared/preflight.js";

export { countGraphemes };

export function validateBlueskyText(text: string): void {
  assertNonEmpty(text, {
    rule: "bluesky.text.non_empty",
    platform: "bluesky",
  });
  assertMaxGraphemes(text, BLUESKY_MAX_GRAPHEMES, {
    rule: "bluesky.text.max_graphemes",
    platform: "bluesky",
  });
}
