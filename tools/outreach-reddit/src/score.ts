import Anthropic from "@anthropic-ai/sdk";
import type { RedditPost } from "./reddit.js";

export type PainCategory =
  | "pricing"
  | "api_break"
  | "missing_platform"
  | "cross_posting"
  | "scheduling"
  | "self_hosting"
  | "other";

export type NextAction = "dm_now" | "reply_publicly" | "watch" | "skip";

export type AIScore = {
  relevance: 1 | 2 | 3 | 4 | 5;
  pain_category: PainCategory;
  signal_strength: "low" | "medium" | "high";
  is_builder: boolean;
  spam_or_bot: boolean;
  reasoning: string;
  suggested_dm: string;
  next_action: NextAction;
};

const SYSTEM_PROMPT = `You are a lead-qualification analyst for letmepost.dev — an open-source social-media publishing API. The wedge: one REST/SDK/MCP surface for Bluesky, Facebook, Instagram, LinkedIn, Pinterest, Threads, TikTok (in review), Twitter/X. Preflight rules, transparent errors, pinned platform versions, idempotency, webhooks. Pricing: Free 50 posts/mo, Pro $79/5k, Business $299/25k. Self-host is free + unlimited.

Score Reddit posts as outbound-sales leads. Only flag is_builder=true when the author is building a product that publishes content programmatically (clipping tools, AI agents, CRMs, niche SaaS with a "post to socials" feature). General SMM users without a product are NOT builders.

Be ruthless. Most posts are noise. Default suggested_dm to a 60-90 word draft that is specific to THIS post — quote a phrase, propose a concrete solution, leave room for a reply. Don't pitch features they don't need.

next_action rules:
- "dm_now" — pain is explicit + recent + builder-fit. Author has a public profile to reach.
- "reply_publicly" — they're asking a question publicly; a useful public reply converts higher than a DM.
- "watch" — interesting but not actionable yet (subscribe, check back).
- "skip" — noise, spam, off-topic, or low signal.`;

export async function scoreLead(
  post: RedditPost,
  matchedQuery: string,
): Promise<AIScore | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const userBody = [
    `Subreddit: r/${post.subreddit}`,
    `Author: u/${post.author}`,
    `Score: ${post.score} | Comments: ${post.numComments}`,
    `Title: ${post.title}`,
    "",
    "Body:",
    post.selftext.slice(0, 4000) || "(link post, no body text)",
    "",
    `Matched query: ${matchedQuery}`,
  ].join("\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userBody }],
    tools: [
      {
        name: "submit_score",
        description: "Submit the lead-qualification verdict.",
        input_schema: {
          type: "object",
          properties: {
            relevance: { type: "integer", minimum: 1, maximum: 5 },
            pain_category: {
              type: "string",
              enum: [
                "pricing",
                "api_break",
                "missing_platform",
                "cross_posting",
                "scheduling",
                "self_hosting",
                "other",
              ],
            },
            signal_strength: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            is_builder: { type: "boolean" },
            spam_or_bot: { type: "boolean" },
            reasoning: {
              type: "string",
              description: "1-2 sentence verdict.",
            },
            suggested_dm: {
              type: "string",
              description: "60-90 word draft tailored to this post.",
            },
            next_action: {
              type: "string",
              enum: ["dm_now", "reply_publicly", "watch", "skip"],
            },
          },
          required: [
            "relevance",
            "pain_category",
            "signal_strength",
            "is_builder",
            "spam_or_bot",
            "reasoning",
            "suggested_dm",
            "next_action",
          ],
        },
      },
    ],
    tool_choice: { type: "tool", name: "submit_score" },
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) return null;
  return toolUse.input as AIScore;
}
