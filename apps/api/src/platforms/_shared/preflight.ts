import { LetmepostError } from "../../errors.js";

export interface RuleContext {
  /** Stable rule id for logs, docs, and clients. e.g. "bluesky.text.max_graphemes" */
  rule: string;
  /** Platform name. e.g. "bluesky" */
  platform: string;
}

/**
 * Count Unicode grapheme clusters — what humans call "characters" — not UTF-16
 * code units. `"👨‍👩‍👧‍👦".length === 11` but its grapheme count is `1`.
 */
export function countGraphemes(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(text)) count++;
  return count;
}

export function assertNonEmpty(
  text: string,
  ctx: RuleContext & { remediation?: string },
): void {
  if (text.trim().length === 0) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: "Post text cannot be empty or whitespace-only.",
      rule: ctx.rule,
      platform: ctx.platform,
      remediation: ctx.remediation ?? "Provide at least one non-whitespace character.",
    });
  }
}

export function assertMaxGraphemes(
  text: string,
  max: number,
  ctx: RuleContext,
): void {
  const count = countGraphemes(text);
  if (count > max) {
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `Post text is ${count} graphemes; ${ctx.platform} allows at most ${max}.`,
      rule: ctx.rule,
      platform: ctx.platform,
      remediation: `Shorten the post to ${max} graphemes or fewer.`,
    });
  }
}

export function assertMaxBytes(
  size: number,
  max: number,
  ctx: RuleContext & { subject?: string; remediation?: string },
): void {
  if (size > max) {
    const subject = ctx.subject ?? "payload";
    throw new LetmepostError({
      code: "preflight_failed",
      status: 400,
      message: `${subject} is ${size} bytes; ${ctx.platform} allows at most ${max}.`,
      rule: ctx.rule,
      platform: ctx.platform,
      remediation:
        ctx.remediation ?? `Reduce the ${subject} to ${max} bytes or fewer.`,
    });
  }
}
