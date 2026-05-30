import "dotenv/config";
import { QUERIES } from "./queries.js";
import {
  REDDIT_REQ_DELAY_MS,
  searchReddit,
  type RedditPost,
} from "./reddit.js";
import { scoreLead } from "./score.js";
import { assertReachable, existsByUrl, insertLead } from "./notion.js";

const MIN_AI_SCORE = Number(process.env.MIN_AI_SCORE ?? "2");
const MAX_AGE_HOURS = Number(process.env.MAX_AGE_HOURS ?? "168");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withinAgeCap(post: RedditPost): boolean {
  if (MAX_AGE_HOURS <= 0) return true;
  const ageMs = Date.now() - post.createdUtc * 1000;
  return ageMs <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

type Stats = {
  queriesRun: number;
  postsFetched: number;
  alreadySeen: number;
  staleSkipped: number;
  scored: number;
  belowThreshold: number;
  spamSkipped: number;
  inserted: number;
  errors: number;
};

async function run(): Promise<Stats> {
  const stats: Stats = {
    queriesRun: 0,
    postsFetched: 0,
    alreadySeen: 0,
    staleSkipped: 0,
    scored: 0,
    belowThreshold: 0,
    spamSkipped: 0,
    inserted: 0,
    errors: 0,
  };

  await assertReachable();

  for (const query of QUERIES) {
    stats.queriesRun++;
    let posts: RedditPost[] = [];
    try {
      posts = await searchReddit(query.q, query.t, query.sub);
      stats.postsFetched += posts.length;
    } catch (err) {
      console.error(`[reddit] query failed: ${query.q}`, err);
      stats.errors++;
      await sleep(REDDIT_REQ_DELAY_MS);
      continue;
    }

    for (const post of posts) {
      if (!withinAgeCap(post)) {
        stats.staleSkipped++;
        continue;
      }
      try {
        if (await existsByUrl(post.permalink)) {
          stats.alreadySeen++;
          continue;
        }
        const ai = await scoreLead(post, query.q);
        if (ai) {
          stats.scored++;
          if (ai.spam_or_bot) {
            stats.spamSkipped++;
            continue;
          }
          if (ai.relevance < MIN_AI_SCORE) {
            stats.belowThreshold++;
            continue;
          }
        }
        await insertLead(post, query.q, ai);
        stats.inserted++;
        console.log(
          `[insert] r/${post.subreddit} · ${ai ? `score=${ai.relevance} ${ai.pain_category}` : "unscored"} · ${post.title.slice(0, 70)}`,
        );
      } catch (err) {
        console.error(`[insert] failed for ${post.permalink}`, err);
        stats.errors++;
      }
    }

    await sleep(REDDIT_REQ_DELAY_MS);
  }

  return stats;
}

run()
  .then((stats) => {
    console.log("\n── run complete ───────────────");
    for (const [k, v] of Object.entries(stats)) {
      console.log(`${k.padEnd(20)} ${v}`);
    }
    process.exit(stats.errors > 0 && stats.inserted === 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
