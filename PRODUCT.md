# letmepost.dev

> Open-source social media publishing API that fails loudly instead of silently.

## What this doc is

Internal product description. Source of truth for positioning, ICP, scope, and product principles so future Claude Code sessions (and future me) start from the same page. **Not a PRD. Not an implementation plan.** No user stories, no acceptance criteria, no sprint planning.

## What letmepost.dev is

A developer-grade HTTP API for publishing to social media platforms. A single endpoint contract (`POST /posts`) that routes to Bluesky, LinkedIn, Twitter/X, Instagram, Facebook, Threads, YouTube, and Pinterest, with **preflight validation, transparent errors, stable API versioning, and idempotency keys** as first-class contracts.

Open-source core (Apache-2.0-ish, TBD), hosted SaaS as the primary commercial offering, self-host as a first-class community option. Same code, same API, no feature gate between the two.

## Who it's for

**Primary ICP — developers building automations and AI agents.** n8n, Make, Zapier, LangGraph, CrewAI. These are the people who discovered at 2 a.m. that their LinkedIn workflow broke because LinkedIn sunset an API version overnight. They are already paying for social posting (X API Basic is $200/mo minimum) and do not have a developer-grade primitive today.

**Secondary ICP — indie hackers and solopreneurs building cross-posting tools.** They currently hand-roll integrations because existing schedulers are "aimed at professional marketers with tons of features we don't need."

**Tertiary — agencies running n8n/Postiz stacks** who want to migrate off Hootsuite/Sprout/Later. Longer sales cycle, strong migration intent signal.

**Not the ICP — end-user creators.** Publer, Typefully, and Hypefury already serve them well, and creators don't buy APIs. We reach creators only indirectly, via UI partners that embed letmepost.dev.

## The problem we're solving

From the 2025-2026 research corpus (150+ citations across GitHub, Trustpilot, Capterra, Hacker News, Reddit, developer forums):

1. **Silent failures dominate developer complaints.** Posts report success then never appear. Tokens rot without warning. Scheduled posts disappear. Error payloads come back as `{ body: {}, message: '' }`. Every incumbent optimized for the happy path; none built for the moment things break.

2. **LinkedIn API version churn is a serial killer of automations.** LinkedIn sunset five API versions in six months (20240401, 20241001, 20241101, 20250101, 20250401), each time simultaneously breaking n8n Cloud, Zapier, Make, Pabbly, and Postiz. The fix in every case was a single HTTP header.

3. **Media upload validation failures are asynchronous and opaque.** Instagram Reels reject Google Drive URLs. YouTube `videos.insert` returns a generic `forbidden` for restricted-scope mismatches. Threads throws cryptic `OAuthException 2207052`. (Historical: TikTok's `file_format_check_failed` was the same shape — TikTok now deferred to v2.) Every one of these is catchable with client-side validation *before* the API call.

4. **OAuth token lifecycle is a production liability.** LinkedIn tokens expire every 60 days and require full re-auth. Meta Instagram: 60 days. Google Business Profile: needs daily refresh. Bluesky access JWTs: minutes.

5. **Per-profile / per-seat pricing is universally hated.** Buffer $6-12/channel, Ayrshare $8.99/profile/mo, Sprout $299-399/seat/year. Complaints dominate competitor Trustpilot scores (Hootsuite 1.4/5, Later 1.4/5, Sprout 1.9/5).

6. **Double-posting loops from retry storms.** The open-source benchmark (Postiz) shipped an infinite double-posting bug in Temporal workflows; the maintainer's own recommended fix was "idempotency keys with the external APIs."

The consistent signal across the corpus: **developers aren't complaining about scheduling — they're complaining about the invisibility of failure.**

## What the product does

At a high level, letmepost.dev exposes a small, opinionated API surface:

- **`POST /posts`** — create or schedule a post across one or many platforms in a single call. Accepts an `Idempotency-Key` header.
- **`POST /posts/validate`** — run preflight validation without sending. Returns the specific rules that would fail, so automations can self-check in CI or before queueing.
- **`POST /accounts/connect/:platform`** — OAuth-backed account connection, including token refresh lifecycle management.
- **Webhooks** — structured events: `post.queued`, `post.validated`, `post.published`, `post.rejected`, `token.expiring`, `version.deprecated`.
- **Public API-version tracker** — a dashboard showing which upstream platform API versions each connected account is pinned to, and upcoming sunsets.

Every post submission flows through: **preflight validator → idempotent execution layer → transparent error contract**. The contract always tells the caller what rule failed and attaches the raw platform response.

## Product principles

These are non-negotiable. If a feature breaks one of these, the feature loses.

### 1. Preflight over postflight

Every platform's documented constraints are checked *before* the platform API call. Character counts (LinkedIn's 3000 emoji-aware, Threads' 500, X's 280), media formats, URL reachability, YouTube container/codec/duration limits + per-project quota awareness, URN patterns, business-account requirements, OAuth scopes — all validated client-side. Async rejections from the platform are always treated as *our* failure to preflight, not the user's failure to read docs.

### 2. Transparent errors

No endpoint ever returns `{ body: {}, message: '' }`. Every error response includes:

- A stable, documented letmepost error code
- The specific rule or precondition that failed
- The raw platform response, where available
- A suggested remediation

Direct response to Ayrshare's own admission that their error 138 "masks multiple distinct underlying causes."

### 3. API version abstraction

Platform API versions are pinned, tracked, and abstracted behind our interface. When LinkedIn sunsets a version, we upgrade internally and publish a changelog — user workflows do not break. The public version tracker makes this legible from the outside.

### 4. Idempotency by default

Every `POST /posts` accepts an idempotency key. Retries are safe. This is a first-class contract, not an afterthought — directly answers the Postiz double-posting bug (issue #1321) that the Postiz maintainer flagged as critical.

### 5. Open source, all the way

Core is open source from day one. Hosted SaaS runs the same code. Self-hosters get the same API. No feature gate between OSS and hosted. The hosted tier wins on infrastructure and managed OAuth, not on locked-away features.

### 6. World-class documentation

Documentation is a product surface, not a deliverable. Best-in-class, Stripe-tier — every endpoint has runnable examples in Python / TypeScript / Go / cURL, every error code has its own page with a real-world reproduction and remediation, every preflight rule is documented with the upstream platform source it derives from, and the public API-version tracker doubles as live reference. If a behavior isn't documented, it doesn't exist. Docs ship with the code, not after.

### 7. Design is paramount — UI, UX, and DX

The API contract, the SDK ergonomics, the error messages, the dashboard, the docs site, the onboarding flow, the OAuth redirect experience — all of it. Every surface a developer or operator touches is designed, not accreted. DX leads: naming, response shapes, defaults, and failure messages are treated with the same care as visual polish. No "we'll fix the UX later." Taste is a product requirement.

## Distribution model

**Hosted SaaS** — primary commercial offering. Managed OAuth, token refresh, infrastructure, webhook delivery, version-pin upgrades. Pricing TBD (see open questions).

**Self-host** — first-class community option. Docker Compose, bring-your-own-credentials, identical API surface. This is how we out-trust Zernio (closed) and out-ship Postiz (unreliable) at the same time.

## Platform scope — v1 is the Publisher

**In scope for v1:** posting, scheduling, queueing, media upload, platform-native variants (e.g., IG Reels vs. feed, LinkedIn org vs. personal).

**Out of scope for v1** (future bets, not this product yet):

- Inbox: DMs, comments, comment replies, review replies
- Ads manager across Meta/Google/YouTube/TikTok/LinkedIn/Pinterest/X
- WhatsApp Business (templates, flows, phone numbers — a standalone product)
- CRM-ish features (contacts, sequences, broadcasts)
- Comment-to-DM automations

### Platform list and build order

Decided from the 90-day Zernio dataset (2026-01-24 → 2026-04-23, 2.78M posts across 15 platforms):

1. **Bluesky** — **first to ship.** Simple AT protocol, no app review, minutes-long JWT lifecycle is a good forcing function for our token-refresh architecture. Small TAM (962 accounts in the data) but proves the end-to-end stack with zero external gating.
2. **LinkedIn** — the wedge platform. #1 complaint volume in the research corpus, cleanest API of the major platforms (4.7% fail rate), no brutal approval gauntlet, 11.6k accounts in the data. Demonstrates preflight + version pinning as a concrete pitch.
3. **Twitter/X** — table-stakes for the automation-builder ICP. 8.1k accounts.
4. **Instagram + Facebook + Threads** — Meta Graph trio, built together because they share auth. Meta app review **must begin day 0** of the project, in parallel with Bluesky and LinkedIn work. Combined ~51% of post volume and 54k accounts.
5. **YouTube** — Data API v3 with `videos.insert` resumable upload. Bounded gating cost: a one-time CASA verification (3–6 weeks first cycle, annual renewal) instead of TikTok's two separate review tracks with frequent rejections. Replaces TikTok in v1 scope.
6. **Pinterest** — cheapest integration, fastest-growing platform in the Zernio dataset (+1369% over 90 days), lowest failure rate (3%). Easy win and a cheap differentiator.

**Deliberately cut from v1:** TikTok (audit complexity — see roadmap deferral note), Reddit (67% fail rate, hostile API), Telegram / Discord / Snapchat / Google Business / WhatsApp (long tail, <1k accounts each in the data).

## How we're different

| vs. | Their weakness | Our wedge |
|---|---|---|
| **Zernio** (closed, positioning-only) | No community trust, closed source, new brand (rebranded from "Late") | Open source, public code, transparent roadmap |
| **Postiz** (26.9k-star OSS benchmark) | Silent failures, double-posting loops, single-tenant architecture blocks SaaS use | Idempotency keys, preflight validation, multi-tenant from day one |
| **Ayrshare** (category leader) | Per-profile pricing, opaque error 138s, broad OAuth scopes | Flat pricing (TBD), rule-specific errors, scoped OAuth |
| **Buffer / Publer / Hypefury** (creator tools) | Creator-focused dashboards, no real API, per-channel pricing | API-first primitive, no dashboard tax |
| **Hootsuite / Sprout / Later** (enterprise) | Contract lock-in, per-seat pricing, auto-renewal abuse | No contracts, no seat tax, no lock-in |

**Open-source alone does not win** — Postiz proves it. The winning combination is open source + preflight + transparent errors + idempotency + stable versions, positioned to the automation-builder and AI-agent-builder cohort first. Creators come later, via UI partners.

## Open questions

Things not yet decided. Future Claude sessions should flag these before assuming.

- **Pricing model.** Flat tier is the research-indicated answer. Shape is TBD — flat + post volume overage, BYO-tokens vs. hosted-tokens, free tier size, self-host always free.
- **MCP / LangGraph / CrewAI adapters.** Research suggests shipping these from day one leapfrogs Zernio on AI-agent ergonomics. Not yet committed to v1.
- **Ayrshare SDK drop-in adapter.** Zernio claims 34/51 methods. A higher-coverage open-source adapter would be a migration lever. Not yet committed.
- **License.** Apache-2.0 is the default assumption; not locked in.
- **Name / tagline.** `letmepost.dev` is the domain. No distinct product brand or tagline committed.

## Related files in this repo

- `initial-exploration.md` — earlier exploration notes (pre-dating this doc)
- `zernio-openapi.yaml`, `zernio-llms.txt` — Zernio's full API surface, for competitive reference
- `zernio-platforms.json`, `zernio-accounts.json`, `zernio-analytics.json`, `zernio-errors.json` — 90-day public Zernio data used for platform-priority decisions
