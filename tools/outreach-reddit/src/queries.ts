export type RedditTimeFilter = "hour" | "day" | "week" | "month" | "year" | "all";

export type SearchQuery = {
  q: string;
  t?: RedditTimeFilter;
  /** Optional restrict-to-subreddit. Empty = all of Reddit. */
  sub?: string;
};

export const QUERIES: SearchQuery[] = [
  // ── Competitor pricing pain ───────────────────────────────────────────
  { q: "ayrshare expensive", t: "month" },
  { q: "ayrshare alternative", t: "month" },
  { q: "ayrshare per profile", t: "month" },
  { q: "buffer api limit", t: "month" },
  { q: "buffer api deprecated", t: "month" },
  { q: "hootsuite api", t: "month" },
  { q: "sprout social alternative", t: "month" },
  { q: "metricool api", t: "month" },
  { q: "publer api", t: "month" },
  { q: "sendible pricing", t: "month" },
  { q: "socialbee api", t: "month" },
  { q: "agorapulse api", t: "month" },

  // ── Platform API break / approval pain ─────────────────────────────────
  { q: "linkedin api broken", t: "month" },
  { q: "linkedin api deprecated", t: "month" },
  { q: "linkedin marketing api approval", t: "month" },
  { q: "linkedin 202504", t: "month" },
  { q: "linkedin 202507", t: "month" },
  { q: "instagram graph api rejected", t: "month" },
  { q: "instagram graph api stuck", t: "month" },
  { q: "instagram business api", t: "month" },
  { q: "instagram content publishing review", t: "month" },
  { q: "facebook graph api rejected", t: "month" },
  { q: "meta app review rejected", t: "month" },
  { q: "tiktok content posting api", t: "month" },
  { q: "tiktok api approved", t: "month" },
  { q: "threads api not working", t: "month" },
  { q: "twitter api v2 pricing", t: "month" },
  { q: "twitter api expensive", t: "month" },
  { q: "x api deprecated", t: "month" },

  // ── Builders looking for cross-post infra ──────────────────────────────
  { q: '"post to instagram" api', t: "month" },
  { q: '"cross post" api', t: "month" },
  { q: '"social media api" recommend', t: "month" },
  { q: '"schedule posts" api', t: "month" },
  { q: "AI clipping tool tiktok", t: "month" },
  { q: "shorts generator instagram", t: "month" },
  { q: "podcast clipping social", t: "month" },
  { q: '"I built" "post to socials"', t: "month" },
  { q: '"I am building" tiktok api', t: "month" },
  { q: "creator tool tiktok api", t: "month" },

  // ── No-code / automation tribe ────────────────────────────────────────
  { q: "n8n linkedin", t: "month" },
  { q: "n8n instagram error", t: "month" },
  { q: "make.com linkedin", t: "month" },
  { q: "zapier linkedin api", t: "month" },
  { q: "n8n social media", t: "month" },

  // ── Self-host / OSS leaning ───────────────────────────────────────────
  { q: '"open source" buffer alternative', t: "month" },
  { q: '"open source" social scheduler', t: "month" },
  { q: "postiz alternative", t: "month" },
  { q: "postiz issue", t: "month" },
  { q: "mixpost alternative", t: "month" },
  { q: '"self hosted" social', t: "month" },
];
