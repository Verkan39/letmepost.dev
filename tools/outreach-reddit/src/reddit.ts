import type { RedditTimeFilter } from "./queries.js";

export type RedditPost = {
  id: string;
  permalink: string;
  url: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  createdUtc: number;
  score: number;
  numComments: number;
  isSelf: boolean;
};

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const ua = process.env.REDDIT_USER_AGENT;
  if (!id || !secret || !ua) {
    throw new Error(
      "Reddit credentials missing — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT.",
    );
  }
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Reddit token failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

type ListingChild = {
  kind: string;
  data: {
    id: string;
    permalink: string;
    url: string;
    title: string;
    selftext: string;
    subreddit: string;
    author: string;
    created_utc: number;
    score: number;
    num_comments: number;
    is_self: boolean;
  };
};

type ListingResponse = {
  data: { children: ListingChild[] };
};

function normalize(child: ListingChild): RedditPost {
  const d = child.data;
  return {
    id: d.id,
    permalink: `https://www.reddit.com${d.permalink}`,
    url: d.url,
    title: d.title,
    selftext: d.selftext,
    subreddit: d.subreddit,
    author: d.author,
    createdUtc: d.created_utc,
    score: d.score,
    numComments: d.num_comments,
    isSelf: d.is_self,
  };
}

export async function searchReddit(
  query: string,
  time: RedditTimeFilter = "month",
  subreddit?: string,
): Promise<RedditPost[]> {
  const token = await getToken();
  const ua = process.env.REDDIT_USER_AGENT!;
  const params = new URLSearchParams({
    q: query,
    sort: "new",
    t: time,
    limit: "25",
    type: "link",
    restrict_sr: subreddit ? "true" : "false",
  });
  const path = subreddit
    ? `/r/${subreddit}/search?${params}`
    : `/search?${params}`;
  const res = await fetch(`https://oauth.reddit.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": ua,
    },
  });
  if (!res.ok) {
    throw new Error(`Reddit search failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as ListingResponse;
  return body.data.children.map(normalize);
}

/** Polite delay between requests — Reddit's documented cap is 60/min. */
export const REDDIT_REQ_DELAY_MS = 1100;
