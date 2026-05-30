# outreach-reddit

Pulls Reddit posts matching a list of pain-signal queries, scores each one
with Claude Haiku, and writes new leads to the `Outreach — Reddit` Notion
database. Dedup is by URL — re-running is safe.

## Setup (5 minutes)

```sh
cd tools/outreach-reddit
npm install
cp .env.example .env
```

Fill in the `.env`:

1. **Reddit** — register a "script" app at <https://www.reddit.com/prefs/apps>.
   Copy the 14-char id (under the app name) into `REDDIT_CLIENT_ID` and the
   27-char secret into `REDDIT_CLIENT_SECRET`. Set `REDDIT_USER_AGENT` to
   something like `letmepost-outreach/0.1 (by /u/your-handle)`.

2. **Notion** — create an integration at
   <https://www.notion.so/profile/integrations>. Copy the `secret_…` token
   into `NOTION_TOKEN`. Open the `Outreach — Reddit` database page, click
   `⋯` → `Connections` → add your integration. `NOTION_DATABASE_ID` is
   pre-filled.

3. **Anthropic** — paste your API key into `ANTHROPIC_API_KEY`. Leave blank
   to skip scoring (posts land in Notion without AI columns populated).

## Run

```sh
npm run start
```

Output:

```
[insert] r/n8n · score=4 api_break · LinkedIn 20250401 broke our automation, …
[insert] r/SaaS · score=5 pricing · Anyone tried Ayrshare? The $149 starter …
…
── run complete ───────────────
queriesRun           48
postsFetched         312
alreadySeen          187
staleSkipped         42
scored               83
belowThreshold       24
spamSkipped          3
inserted             56
errors               0
```

## Tuning

- `MIN_AI_SCORE` (default 2) — drop AI-scored leads below this relevance.
  Set to 0 to insert everything that wasn't flagged as spam.
- `MAX_AGE_HOURS` (default 168) — drop posts older than this. Bump to 720
  (30 days) for a wider net on the first run.

## Cost

Reddit + Notion free. Anthropic Haiku 4.5 costs ~$0.0005 per lead scored
with prompt caching. A 200-leads/day run is well under a dollar a week.

## Schedule

GitHub Actions cron lives at `.github/workflows/outreach.yml`. Add the
four env vars as repo secrets (Settings → Secrets and variables →
Actions) under the same names as the `.env` file.

## What's intentionally NOT in here

- No DM automation. The point is to triage in Notion and send yourself.
- No public-reply automation. Same reason.
- No subreddit firehose. Keyword search keeps the corpus narrow enough
  that even cheap Haiku triage hits sub-cent per run.
