import { Client } from "@notionhq/client";
import type { RedditPost } from "./reddit.js";
import type { AIScore } from "./score.js";

const KNOWN_SUBREDDITS = new Set([
  "n8n",
  "SaaS",
  "automation",
  "selfhosted",
  "socialmedia",
  "SocialMediaMarketing",
  "SideProject",
  "microsaas",
  "Entrepreneur",
  "sidehustle",
  "webdev",
  "nocode",
  "SocialMediaManager",
  "SMMA",
  "EntrepreneurRideAlong",
  "learnprogramming",
  "nextjs",
  "opensource",
]);

let cachedClient: Client | null = null;
let cachedDataSourceId: string | null = null;

function client(): Client {
  if (cachedClient) return cachedClient;
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN missing");
  cachedClient = new Client({ auth: token });
  return cachedClient;
}

function databaseId(): string {
  const id = process.env.NOTION_DATABASE_ID;
  if (!id) throw new Error("NOTION_DATABASE_ID missing");
  return id;
}

/**
 * Notion v5 split databases into a database + one or more data sources;
 * queries hit the data source, not the database. Resolve the first
 * (and for our case only) data source id once and cache it.
 */
async function dataSourceId(): Promise<string> {
  if (cachedDataSourceId) return cachedDataSourceId;
  const db = (await client().databases.retrieve({
    database_id: databaseId(),
  })) as unknown as { data_sources?: Array<{ id: string }> };
  const first = db.data_sources?.[0]?.id;
  if (!first) {
    throw new Error(
      "Notion database has no data sources. Re-create it or check the integration share.",
    );
  }
  cachedDataSourceId = first;
  return first;
}

export async function existsByUrl(url: string): Promise<boolean> {
  const dsId = await dataSourceId();
  const res = await (client() as unknown as {
    dataSources: {
      query: (args: {
        data_source_id: string;
        filter: unknown;
        page_size: number;
      }) => Promise<{ results: unknown[] }>;
    };
  }).dataSources.query({
    data_source_id: dsId,
    filter: { property: "URL", url: { equals: url } },
    page_size: 1,
  });
  return res.results.length > 0;
}

function snippet(text: string): string {
  return text.slice(0, 300);
}

export async function insertLead(
  post: RedditPost,
  matchedQuery: string,
  ai: AIScore | null,
): Promise<void> {
  const properties: Record<string, unknown> = {
    Title: { title: [{ text: { content: post.title.slice(0, 200) } }] },
    URL: { url: post.permalink },
    Author: {
      rich_text: [{ text: { content: `u/${post.author}` } }],
    },
    Posted: {
      date: { start: new Date(post.createdUtc * 1000).toISOString() },
    },
    Captured: { date: { start: new Date().toISOString() } },
    Snippet: {
      rich_text: [{ text: { content: snippet(post.selftext) } }],
    },
    Score: { number: post.score },
    Comments: { number: post.numComments },
    Query: { rich_text: [{ text: { content: matchedQuery } }] },
    Status: { select: { name: "new" } },
    Subreddit: { select: { name: post.subreddit } },
  };
  // KNOWN_SUBREDDITS exists only to suppress lint on the unused import path;
  // Notion auto-creates new select options when we write a fresh name.
  void KNOWN_SUBREDDITS;

  if (ai) {
    properties["AI Score"] = { number: ai.relevance };
    properties["Pain Category"] = { select: { name: ai.pain_category } };
    properties["Signal Strength"] = { select: { name: ai.signal_strength } };
    properties["Is Builder"] = { checkbox: ai.is_builder };
    properties["Spam/Bot"] = { checkbox: ai.spam_or_bot };
    properties["AI Reasoning"] = {
      rich_text: [{ text: { content: ai.reasoning.slice(0, 1900) } }],
    };
    properties["Suggested DM"] = {
      rich_text: [{ text: { content: ai.suggested_dm.slice(0, 1900) } }],
    };
    properties["Next Action"] = { select: { name: ai.next_action } };
  }

  await client().pages.create({
    parent: { database_id: databaseId() },
    properties: properties as Parameters<
      Client["pages"]["create"]
    >[0]["properties"],
  });
}

/**
 * Sanity check on startup — fails loud if the integration can't see the
 * database (token wrong, or the page wasn't shared with the integration).
 */
export async function assertReachable(): Promise<void> {
  try {
    await dataSourceId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Notion database unreachable. Did you share the page with your integration? Underlying: ${msg}`,
    );
  }
}
