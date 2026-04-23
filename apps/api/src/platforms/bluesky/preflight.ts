import { BLUESKY_MAX_GRAPHEMES } from "@letmepost/schemas";
import { LetmepostError } from "../../errors.js";

export function countGraphemes(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(text)) count++;
  return count;
}

export function validateBlueskyText(text: string): void {
  if (text.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Post text cannot be empty or whitespace-only.",
      rule: "bluesky.text.non_empty",
      platform: "bluesky",
      remediation: "Provide at least one non-whitespace character.",
    });
  }
  const graphemes = countGraphemes(text);
  if (graphemes > BLUESKY_MAX_GRAPHEMES) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Post text is ${graphemes} graphemes; Bluesky allows at most ${BLUESKY_MAX_GRAPHEMES}.`,
      rule: "bluesky.text.max_graphemes",
      platform: "bluesky",
      remediation: `Shorten the post to ${BLUESKY_MAX_GRAPHEMES} graphemes or fewer.`,
    });
  }
}
