# letmepost.dev — Phased v1 Roadmap

## Context

**Status (April 2026):** Phases 1–5.5 landed; **Phase 6 LinkedIn MVP shipped** (personal-account text UGC + 3,000-grapheme preflight + URN validation + version-pinning client) with MDP-gated org/Company-Page posting deferred; **Phase 7 dashboard substantially complete** — sign-in/up, /onboarding silent recovery, 3-step accordion onboarding (API key + connect platform + send first post) with auto-advance + step-locking, brand-aligned theme (paper cream + forest green + Commit Mono + Instrument Serif wordmark), framer-motion blur transitions, full sidebar with org switcher + profile switcher + nav, /profiles CRUD, profile picker on connect flows, profile scope on API key create, profile filter + time-range + error-code multi-select + manual refresh + focus refetch on the Post Log (now a TanStack Table), inline OAuth/credentials connect (no detour), webhook chip multi-select + synchronous test-deliver dialog with editable JSON preview; MVP slices of Phase 8 (Twitter/X) and Phase 11 (Pinterest) publishers shipped behind the AccountProvider framework. **179+ API tests green.** Bluesky publishes end-to-end today; LinkedIn personal posts publish; Pinterest connects end-to-end via the OAuth callback handler but the publish path is gated on the media-upload service (Phase 7.5).

**Production live:** API at `https://api.letmepost.dev` (Railway), dashboard at `https://dashboard.letmepost.dev`, landing at `https://letmepost.dev`. NeonDB Postgres + Upstash Redis. The OAuth callback handler ships server-side state (HMAC-signed, 10-min TTL) so Pinterest/LinkedIn round-trips complete without a server-side session table. Cross-subdomain cookies wired via `COOKIE_DOMAIN=.letmepost.dev`.

**Approvals in flight (April 2026):**
- **Meta App Review** — business verification in progress; submission tomorrow
- **LinkedIn MDP** — submitted, awaiting review
- **Pinterest Standard Access** — pending demo video recording (Trial Access works today; pins are private to the creator until Standard clears)
- **X paid tier + YouTube CASA** — not yet submitted

**Scope decision (April 2026):** YouTube replaces TikTok for v1. TikTok is deferred to v2. Reasoning: YouTube's OAuth verification is a one-time annual security review with a known timeline; TikTok's Content Posting API approval is two separate audits (Upload + Direct Post), each on a 4–10-week manual review with frequent rejections, and the audit-state SELF_ONLY constraint complicates the demo path. We pick the platform where the gating cost is bounded.

**Immediate next slice (April 2026):** before resuming the new-platform phases, lock Bluesky and Pinterest to "perfect" — every API endpoint, every preflight rule, every webhook event verified end-to-end against production. This requires the media-upload service (Phase 7.5) as a foundation; Pinterest's publish path can't function without per-post media, and Bluesky video needs the same plumbing. Two-platform polish first, then Meta / X / YouTube once approvals clear.

What's still missing from the original plan: Phase 6 LinkedIn org/Company-Page posting (MDP-gated), **Phase 7.5 Media Upload Service (new)**, Phase 9 Meta trio, Phase 10 YouTube, Phase 11 Pinterest rewrite, Phase 12 SDK pipeline, Phase 13 docs polish, Phase 14 obs + launch prep, Phase 15 launch. Phase 5.5 (Profiles) was added after the initial plan to pick up the agency / multi-brand use case without per-profile pricing — both API and dashboard are done.

This plan takes us from that state to a public v1 launch. Every phase is filtered through the **seven product principles** in `PRODUCT.md` and traces to the **six research-corpus problems** we exist to solve:

1. **Silent failures** — posts "succeed" then never appear; `{body:{}, message:""}`; scheduled posts disappearing.
2. **LinkedIn API version churn** — 5 versions sunset in 6 months simultaneously breaking every competitor. Fix is one HTTP header.
3. **Opaque media upload rejections** — Instagram Reels, YouTube quota / aspect-ratio rejects, Threads `OAuthException 2207052` (and TikTok's `file_format_check_failed` historically — TikTok is now v2). All catchable with preflight.
4. **OAuth token lifecycle rot** — LinkedIn/Meta 60d, GBP daily, Bluesky minutes.
5. **Per-profile / per-seat pricing** — universally hated.
6. **Double-posting from retry storms** — Postiz #1321; fix is idempotency keys.

The goal is not to match any competitor's feature count. The goal is to be the publishing primitive where **failure is loud, preventable, and documented** — with API version abstraction and flat pricing as the commercial wedges.

**Honest estimate: 30 weeks of coding, 7–8 months to public launch** accounting for Meta + YouTube verification variance. (Original 28; +1 for Phase 5.5 profiles retrofit; +1 for Phase 7.5 media service.)

---

## Day 0 — Prerequisites (NOT a phase; fire before Phase 1)

These are calendar-gated and take months. Start them all before writing any Phase 1 code.

| Action | Why Day 0 | Expected wait | Buildable pre-approval? | Status (April 2026) |
|---|---|---|---|---|
| **Meta App Review** (IG Graph + FB Pages + Threads) | 2–8 weeks per review cycle, rejections normal, business verification is its own slog | 6–12 weeks realistic | **Yes.** App in Development Mode can publish to the developer's own account + any account registered as a Tester. Same Graph API endpoints, same response shapes as post-approval — approval only lifts the "testers only" restriction. Phase 9 is genuinely a same-day deploy on approval. | Business verification in progress; submission tomorrow |
| **YouTube OAuth verification** (Google Cloud) | Restricted-scope (`youtube.upload`) requires a one-time security assessment by an approved third-party CASA auditor; ~3–6 weeks first time, annual renewal after | 3–6 weeks first cycle | **Yes.** Unverified apps cap at 100 lifetime users — fine for staged rollout while the assessment runs. Same Data API v3 endpoints, same response shapes; verification only lifts the user cap and the unverified-app warning screen. | Not yet submitted |
| **X API paid tier** | Paid billing near-instant; Elevated write + use-case review 1–3 weeks. **⚠ Feb 2026 shift:** X killed tiered pricing for new signups — Basic/Pro are closed to new developers; pay-per-use is the new floor. Budget starts accruing from Phase 8 start, not from launch. Revisit whether X stays in v1. | 1–3 weeks | **Partial.** No free write path; pay-per-use bills from the first call. | Not yet submitted |
| **LinkedIn MDP / Community Management API** application | Many post scopes require MDP approval; we want this ready by Phase 6 | 2–6 weeks | **Partial.** Personal-account posting (`w_member_social`, Share on LinkedIn product) works on the standard dev tier without MDP. MDP / Community Management API gates **org- and company-page** posting only. ~60–70% of Phase 6 (personal posts, preflight suite, version-pinning layer, person-URN validation) is buildable day 0; the org-post codepath waits on approval. | Submitted, awaiting review |
| **Pinterest developer account + trial access** | Needed by Phase 11 | 1–2 weeks | **Yes.** Trial Access is the sandbox — all endpoints exposed, pins private to creator until Standard approval (requires a video of the OAuth flow). | Trial Access live; Standard pending demo video |

Also Day 0 (non-gating, cheap): register `letmepost` GitHub org, reserve `@letmepost` npm scope, reserve `letmepost` on PyPI, create empty `letmepost/sdk-python` and `letmepost/sdk-go` repos.

---

## Phase 1 — Persistence & Tenancy Foundation - DONE

**Goal:** Turn the single-tenant Bluesky prototype into a multi-tenant service with real data.

**Ships:** NeonDB project with branching-per-preview; Drizzle schemas (`users`, `organizations`, `api_keys`, `accounts` with encrypted token blobs, `posts`, `post_attempts`, `idempotency_records`, `webhook_endpoints`, `platform_versions`); `drizzle-kit` migration tooling; seeding harness for tests; AES-256-GCM envelope encryption module (DEK-per-token, KEK in env, rotation-ready); `AccountsRepository` / `PostsRepository` interfaces.

**Problems solved:** Enabling (unblocks 4, 6).
**Principles served:** 5 (same schema OSS + hosted), 7 (data shapes designed).
**Depends on:** Nothing.
**Effort:** 1.5 weeks.
**Risks:** Drizzle relational queries vs. migration ergonomics diverge occasionally; Neon branching in CI is sharp-edged.
**NOT in scope:** Auth, queue, webhooks, OAuth, new platforms. No user-visible endpoint changes.

## Phase 2 — Auth, API Keys, and Org Model - DONE

**Goal:** Authenticated multi-tenant API access.

**Ships:** `better-auth` with email/password + API-keys plugin + organizations plugin; `POST /v1/api-keys`, `GET /v1/api-keys`, `DELETE /v1/api-keys/:id` (internal only — no dashboard yet); Bearer-token middleware with org scoping on every query; key prefixing (`lmp_live_…` / `lmp_test_…`) and last-4 storage; hash-indexed key lookup; Bluesky publisher migrated off request-body credentials onto the `accounts` table.

**Problems solved:** Enabling.
**Principles served:** 5, 7.
**Depends on:** Phase 1.
**Effort:** 1.5 weeks.
**Risks:** better-auth's API-keys plugin edges — if it bites for more than 2 days, fall back to a hand-rolled keys table.
**NOT in scope:** OAuth connect flows, dashboard UI, billing, webhooks, queue.

## Phase 3 — Idempotency, Rate Limiting, Error Contract - DONE

**Goal:** Make every write safe to retry, every response structurally transparent.

**Ships:** `Idempotency-Key` on all writes (24h replay window, stored response fingerprint, conflict detection on body mismatch); `@upstash/ratelimit` (per-key quota + per-IP floor + per-platform connect-attempt floor); canonical `ErrorResponse` contract finalized in `packages/schemas` (code, rule, platform, platform_version, platform_response, remediation, request_id, trace_id); error-code registry module ready for docs; Sentry wired; Axiom OTel exporter wired for logs + traces.

**Problems solved:** 1 (silent failures), 6 (double-posting).
**Principles served:** 2, 4.
**Depends on:** Phase 1, 2.
**Effort:** 1.5–2 weeks.
**Risks:** Idempotency semantics on future multi-platform posts is subtle — design the storage shape now so Phase 6+ doesn't force a migration.
**NOT in scope:** Per-platform error mapping (happens in each platform phase); webhooks; dashboard.

## Phase 4 — Job Queue, Scheduling, Webhooks - DONE

**Goal:** Everything that makes "it posted" or "it failed" actually observable.

**Ships:** BullMQ on Upstash Redis with `publish`, `validate`, `refresh-token`, `webhook-deliver` queues; separate Railway worker service; `POST /v1/posts` accepts `scheduled_at` (delayed jobs); webhook subsystem with HMAC-SHA256 signing, exponential backoff, dead-letter queue, `/v1/webhook-endpoints` CRUD; event catalog (`post.queued`, `post.validated`, `post.published`, `post.rejected`, `post.failed`, `token.expiring`, `token.revoked`, `version.deprecated`); worker retries use idempotency keys on upstream platform APIs where supported; existing Bluesky publisher refactored through the queue.

**Problems solved:** 1 (scheduled-post disappearing), 6 (retry storms).
**Principles served:** 2, 4.
**Depends on:** Phases 1–3.
**Effort:** 2 weeks.
**Risks:** Upstash connection cap on free tier; Railway worker cold-start when queue is idle. Decide "what happens on a 5xx from a webhook consumer" before coding — single most-asked integrator question.
**NOT in scope:** Webhook replay UI, delivery logs UI (dashboard later), per-event filter subscriptions.

## Phase 5 — OAuth Connect Framework + Bluesky Migration - DONE

**Goal:** Generic account-connect machinery that every platform plugs into. The framework is the product.

**Ships:** `POST /v1/accounts/connect/:platform` returning OAuth URL (or app-password form for Bluesky); `GET /v1/accounts/oauth/:platform/callback` generic callback router; `GET /v1/accounts`, `DELETE /v1/accounts/:id`; token refresh scheduler sized per-platform (Bluesky minutes, LinkedIn 60d, Meta 60d, GBP daily); `token.expiring` webhook at 7 days out; scope registry (narrow by default — direct answer to Ayrshare's broad-scope complaint); Bluesky migrated onto the framework with existing 20 tests still green.

**Problems solved:** 4 (token rot), partial 2 (scoped OAuth).
**Principles served:** 2, 5, 7.
**Depends on:** Phases 1, 2, 4.
**Effort:** 2 weeks.
**Risks:** PKCE vs. classic OAuth differences across LinkedIn/X/Meta must not become `if platform === …` soup. Invest in the abstraction.
**NOT in scope:** LinkedIn publisher itself (next phase), dashboard UI.

## Phase 5.5 — Profiles (Workspace Primitive) - DONE

**Goal:** Zernio-style profiles — an org sub-unit that groups platform accounts. Agencies get one org with 20 profiles (one per client); a brand with multiple product lines gets multiple profiles under one org. Crucially: **profiles are free.** Per-profile pricing is research-corpus problem #5; we use profiles as a structure primitive and keep pricing flat at the org level — that's a commercial wedge against Ayrshare / Zernio in itself.

**Ships:** new `profiles` table (`id`, `organization_id`, `name`, `slug`, `created_at`, `updated_at`); `platform_accounts.profile_id` NOT NULL with a "Default" profile auto-created per org in the migration (all existing rows attach to it); `api_keys.scope` gains optional `profile_id` so keys can be narrowed to a single profile (empty scope = org-wide, preserves existing behavior); `/v1/profiles` CRUD (create / list / rename / delete — delete blocked when non-empty); all `/v1/accounts` and `/v1/posts` routes accept and enforce the profile scope; dashboard gets a profile switcher in the sidebar (primary day-to-day surface; org switcher moves to a settings page); post + webhook lifecycle events carry `profileId` in the data payload.

**Problems solved:** 5 (we *have* the structure others charge per-unit for, without the charge). Enabling for multi-client agencies, which are a high-LTV segment.
**Principles served:** 5 (same schema OSS + hosted), 7 (data shapes designed — retrofit *before* real users, not after).
**Depends on:** Phases 1, 2, 5.
**Effort:** 1 week.
**Risks:** API-key scope semantics is the subtle part — an org-wide key must still work against any profile's accounts; a profile-scoped key must 404 on cross-profile account IDs. Build the test matrix up front (org-key × profile-key × same-profile × cross-profile × missing-account).
**NOT in scope:** Per-profile billing or usage meters (Phase 14); per-profile webhook endpoints (endpoints stay org-scoped; consumers filter on the `profileId` event field); per-profile custom branding; cross-profile account sharing.

## Phase 6 — LinkedIn: The Wedge - PARTIAL

**Status:** Personal-account text UGC publishes today via the AccountProvider framework. 3,000-grapheme preflight + URN validation + the `LinkedIn-Version`-pinned client are live. Org / Company-Page posting and the full media surface (image, multi-image, video, document, article preflight with OG-tag fetch) wait on MDP approval.

**Goal:** Ship the platform that *demonstrates the pitch*. This is the phase that has to be visibly better than every competitor.

**Ships:** LinkedIn OAuth (personal + organization) through the Phase 5 framework with MDP scopes; `POST /v1/posts` with `platform: "linkedin"` — text, article share, single image, multi-image, video, document; **preflight validator suite** (each a pure function with its own tests):
- 3,000-grapheme emoji-aware limit (matches LinkedIn's real counter)
- URN pattern validation (`urn:li:person:…` / `urn:li:organization:…`)
- Org-post authorization (ACL preflight)
- Media type + size + aspect-ratio rules
- `visibility` enum + `lifecycleState` legal values
- Article URL reachability + OG-tag preflight

**Version abstraction layer:** every LinkedIn call goes through a client that pins `LinkedIn-Version`; version is a single config value; upgrades are one commit. LinkedIn error mapper: every known error code → letmepost error code + rule + remediation, raw response preserved. `GET /v1/platform-versions` public endpoint. Contract-test suite against real LinkedIn on a cron (not in the fast loop). `POST /v1/posts/validate` endpoint — preflight only, no publish.

**Problems solved:** 1, 2 (the headline), 3 (opaque rejections pattern).
**Principles served:** 1, 2, 3 — this phase *is* the pitch.
**Depends on:** Phases 1–5.5; MDP approval from Day 0.
**Effort:** 3 weeks. This phase must be excellent, not fast.
**Risks:** MDP approval blocking; LinkedIn dev-tier rate limits; URN edge cases for Company Pages vs. Showcase Pages. This is the phase you'll be tempted to cut corners on — don't.
**NOT in scope:** Carousels beyond image-multi, polls, events, analytics, comment threads, DMs.

## Phase 7 — Minimal Dashboard (Operator Surface Only) - DONE

**Goal:** Get out of curl-only. Ship exactly what onboarding + debugging need — nothing else.

**Ships:** `apps/dashboard` Next.js App Router with better-auth session, shadcn component system, Commit Mono + Instrument Serif wordmark + paper/forest-green theme matching the landing, framer-motion blur+y transitions across page changes, list staggers, and accordion expansions. TanStack Table renders the Post Log; TanStack Query owns client-side data fetching. Screens shipped:
- **Sign-in / sign-up** with org creation in the same flow; sign-up failure paths fall through to /onboarding rather than stranding the user.
- **/onboarding** — silent recovery for sessions without an active org. No form: picks the first existing org, else creates one named after the user, then bounces. Only flashes a "Setting up workspace…" line if the redirect takes >250ms.
- **Dashboard home** — first-run accordion checklist (Copy your API key → Connect a platform → Send your first post) with auto-advance, step locking until the prior step completes, and per-step bodies that include a real curl preview, brand-icon platform grid, and a live "Send test post" button. Once every step is done, the checklist fades out and the count cards (accounts / API keys / webhooks) fade in.
- **Inline platform connect** — brand-icon grid (Bluesky, LinkedIn, Pinterest, X) with grayscale → color hover. OAuth platforms full-page-redirect to the provider's authorize URL; credentials platforms swap the grid for a dynamic field form (descriptor-driven). Both pass `profileId` so the resulting account lands in the right workspace.
- **Sidebar** — brand mark + org switcher (with shadcn dialog for new-org), profile switcher ("Working in: …") with localStorage-keyed-per-org persistence, full nav (Dashboard / Logs / Accounts / Profiles / API keys / Webhooks), avatar footer with sign-out.
- **/profiles** — CRUD with auto-derived slug preview, rename dialog, delete confirm that surfaces the API's 409 not-empty rule.
- **Account list** — per-profile, with token-expiry timestamps and confirm-on-disconnect.
- **/accounts/new** — same descriptor-driven flow as the inline onboarding connect, with profile picker.
- **API Keys** — list / create / revoke. Create form has Name + Environment (live/test) + Scope (org-wide / per-profile). Each row shows env, scope, prefix, last-4. Plaintext shown once in a modal; "Copy" + "Done" buttons.
- **Webhook endpoints** — create / filter events (chip multi-select bound to `WEBHOOK_EVENT_TYPES`) / delete. Signing secret shown once. **Send Test** button per row opens a dialog with event-type select + editable JSON payload (per-type defaults that swap intelligently when the user picks a new type without overwriting their edits) + delivery result panel showing HTTP status, latency, response body — fires `POST /v1/webhook-endpoints/:id/test` synchronously.
- **Post Log** — the operator's "where did my post go" screen. TanStack Table with columns (When | Platform | Status | Account | Text | Error code | →). Server-side filters: **profile × platform × status × error-code × time-range** (Last 24h / 7d / 30d / All / Custom range dialog). Manual Refresh button + automatic refetch on tab focus. Keyset pagination via opaque cursor. Detail view renders the full `ErrorResponse` contract inline — code, rule, platform, platform_version, platform_response, remediation — plus the attempts timeline and a copy-as-curl reproducer that pre-fills `${prefix}…${last4}` from the user's actual keys (key picker), inlines `mediaRefs` + `scheduledAt`, and uses `$(uuidgen)` for the Idempotency-Key.

Destructive actions (disconnect account, revoke key, delete endpoint, delete profile) all confirm via shadcn modals.

**Problems solved:** 1 (visibility of failure is the whole Post Log).
**Principles served:** 7.
**Depends on:** Phases 1–5.5, 6.
**Effort:** Done.
**NOT in scope:** Billing, analytics dashboards, team invites beyond single-org, whitelabel, theming switcher, mobile-first layout, API call log (request-level, as opposed to post-level), webhook delivery log (deferred — needs a backend ticket to expose BullMQ delivery history; today only the synchronous test-deliver round-trip is visible).

## Phase 7.5 — Media Upload Service + Bluesky/Pinterest hardening

**Goal:** Per-post media as a first-class concept across every publisher, plus the foundation that lets Pinterest, YouTube, and any future video platform actually publish without per-platform carve-outs. Then lock Bluesky and Pinterest to "perfect" against the live API before we resume new-platform work.

**Why now:** Pinterest's publish path today reads `boardId / destinationUrl / imageUrl` from `platform_account.tokenMetadata` — a documented hack from when media wasn't a real concept. The `lmp-test` script exposed the gap end-to-end. YouTube long-form videos and Bluesky video both need the same plumbing. Doing this once unblocks three platforms.

**Ships:**

*Media upload service:*
- New `POST /v1/media` — multipart, streams direct to S3 via `@aws-sdk/lib-storage`'s `Upload` (handles 100 MB+ video uploads without buffering server-side). Returns `{ id, url, contentType, sizeBytes, sha256 }`.
- New `media` table — `(id, organizationId, profileId?, contentType, sizeBytes, sha256, s3Key, createdAt)`. No automatic deletion in v1; bucket grows forever (lifecycle policy is a follow-up if cost demands).
- S3 bucket `letmepost-media` in `us-east-1` (same region as Railway), single bucket with `${env}/${orgId}/${mediaId}.${ext}` keys, **public-read via bucket policy** on `s3:GetObject` (Block Public Access OFF on the bucket; object ACLs stay disabled — Object Ownership = "Bucket owner enforced"). Keys carry ~131 bits of entropy (`med_` + 22 base62), so security rests on key unguessability rather than a closed bucket.
- New env: `AWS_REGION=us-east-1`, `S3_BUCKET=letmepost-media`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BASE_URL` (e.g. `https://letmepost-media.s3.us-east-1.amazonaws.com`), `MEDIA_ENV_PREFIX` (`prod` / `dev`). `.env.example` updated; Railway's `apps/api` service gets the secrets.
- **Future: signed URLs / CloudFront.** v1 deliberately ships public objects with unguessable keys — simplest, robust to Pinterest/Meta re-fetches, and the migration to private + signed URLs (or CloudFront signed cookies) is a one-env-var swap of `MEDIA_PUBLIC_BASE_URL` plus a small change to URL construction. Revisit when (a) a real bandwidth bill shows up, (b) we need byte-range / CDN behavior, or (c) a customer requires private media. Owner: whoever is on call for the first cost spike.
- `MediaInput` schema in `packages/schemas` gets a third variant: `{ kind, mediaId }` referencing a `/v1/media` upload. The existing `{ url }` and `{ bytesBase64 }` variants stay (URL passthrough is still useful for callers who already have a CDN; bytes-inline stays for tiny images).
- Shared `apps/api/src/platforms/_shared/media.ts` resolver — every publisher calls `resolveMedia(item)` to get the bytes-or-URL it needs. Three branches: `mediaId` → fetch row, derive S3 URL; `url` → passthrough; `bytesBase64` → decode.

*Bluesky hardening (already publishes text):*
- Single + multi-image carousel (max 4) via the new media plumbing
- Alt text round-trip end-to-end (preflight + publish)
- Video posts (Bluesky added these in 2024; ~100 MB MP4) via the same `mediaId` flow
- Tighten preflight: image count, mime allowlist, exact size limits (1 MB images / 100 MB video), alt-text grapheme cap (2,000)
- Confirm `post.queued → post.validated → post.published` webhook chain fires for every variant
- `POST /v1/posts/validate` works for Bluesky (preflight-only)
- `lmp-test` script grows: text post (today), single-image post, multi-image carousel, video post, alt-text echo, validation-only run

*Pinterest rewrite:*
- At OAuth-complete, fetch the user's boards via `GET /v5/boards` and store `defaultBoardId` on the account
- Drop the `tokenMetadata.boardId/destinationUrl/imageUrl` carve-out entirely (delete the dispatch.ts code, gut the publisher's metadata reader)
- Publisher reads `media[0]` (URL or `mediaId`), `text` as description, board from `account.defaultBoardId`
- Per-post override extension: `pinterest: { boardId?, destinationUrl?, title? }` on the post body — the documented escape hatch for callers who want something other than the default board
- Dashboard surfaces a "Default board" picker on the Pinterest account row (small select, fed by `GET /v5/boards`)
- Image preflight: dimensions + aspect + size + URL reachability (the existing rules), now wired to the resolver instead of the metadata bag
- `lmp-test` Pinterest test sends `media: [{ kind: "image", url }]` and expects a real publish

**Problems solved:** 3 (opaque media rejections — Pinterest specifically gets the proper preflight; foundation for IG Reels / YouTube same shape).
**Principles served:** 1 (preflight is the wedge), 2 (transparent errors continue), 4 (one media abstraction across N platforms).
**Depends on:** Phases 1–7. The dashboard's connect drawer is reused as-is; only the post-publish path changes.
**Effort:** ~1 week — media service (2 days) + Bluesky hardening (1–2 days) + Pinterest rewrite (2–3 days).
**Risks:** S3 IAM policy footguns (public-read object ACLs disabled by default on new buckets — set bucket policy + Object Ownership = "Bucket owner enforced"); `@aws-sdk/lib-storage` chunk size tuning for slow uploaders.
**NOT in scope:** S3 lifecycle deletion, CloudFront, byte-range serving, image transformation (resize / re-encode), video transcoding, signed-URL upload flow (callers go through our multipart endpoint; presigned PUT is a future option once we hit bandwidth pain).

## Phase 8 — Twitter/X

**Goal:** Second commercial platform; validates the framework is generic.

**Ships:** X OAuth 2.0 PKCE, refresh-token lifecycle; `POST /v1/posts` with `platform: "x"` including threads (reply-chain sequencing), polls, quote-tweets, single/multi-media, alt-text; preflight (280-grapheme / 25,000 for premium, media count + mime + size, thread reply-chain well-formedness, URL-shortening-aware counting); X-specific error mapper (duplicate-tweet, tweet-length, media format); paid-tier rate-limit surfacing (we tell users how close to ceiling they are — a small differentiator).

**Problems solved:** 1, 3.
**Principles served:** 1, 2, 3.
**Depends on:** Phases 1–6.
**Effort:** 2 weeks.
**Risks:** X API policy changes; Elevated/Pro tier write quota.
**NOT in scope:** Spaces, Community posts, ads.

## Phase 9 — Meta Trio (IG + FB + Threads)

**Ready-to-build gate:** Meta App Review approved.

**Ships:** Facebook Login for Business flow covering Pages + IG Business + Threads scopes; publishers per platform — IG (Feed single, carousel, Reels, Stories), FB (Page post, photo, video, link share), Threads (text, media, reply); preflight validator suites per platform — Reels (9:16 aspect, codec + duration + size, cover-frame), Threads (500-char + reply constraints), FB link preview (OG reachability), IG URL source (publicly reachable CDN preflight — direct answer to the Google-Drive-URL failure pattern); error mappers for `OAuthException 2207052`, rate-limit code 4, IG media-publish async status polling (we await and surface, not silently-success); business-account-type preflight.

**Problems solved:** 1, 3, 4.
**Principles served:** 1, 2, 3.
**Depends on:** Phases 1–6; Meta approval.
**Effort:** 3 weeks.
**Risks:** Biggest external blocker in the plan. Keep engineering ready-to-ship so you deploy same-day on approval. Also: media CDN + transient storage is a mini-decision (R2 or S3-compatible in Railway).
**NOT in scope:** Shopping tags, collab posts, branded content, ads, Threads DM.

## Phase 10 — YouTube

**Ready-to-build gate:** Google Cloud project with YouTube Data API v3 enabled. Verification (CASA) runs in parallel with build — unverified-app cap of 100 users is fine for staged rollout while the assessment clears.

**Ships:** YouTube OAuth 2.0 with offline access + refresh-token lifecycle (Google's refresh tokens are long-lived but revoke on inactivity / scope changes); `POST /v1/posts` with `platform: "youtube"` — resumable upload to `videos.insert` with status `private` / `unlisted` / `public`; preflight validator suite (video container + codec — H.264 / H.265 / AV1 / VP9; audio codec — AAC / Opus; max file size — 256 GB / 12 hours; aspect ratio + resolution — Shorts vs. long-form; title ≤ 100 chars; description ≤ 5000 chars; ≤ 500 tags totaling ≤ 500 chars; categoryId in the per-region allowlist; thumbnail dimensions when supplied); resumable upload chunking with retry on transient 5xx; quota-cost surfacing (Data API spends 1600 units per upload against a default 10k/day project budget — we tell users how much budget remains, a small differentiator); error mapper for `quotaExceeded`, `forbidden`, `videoChunkTooBig`, `uploadLimitExceeded`, `mediaBodyRequired`. `POST /v1/posts/validate` runs the preflight without uploading.

**Problems solved:** 1, 3, 4.
**Principles served:** 1, 2, 3.
**Depends on:** Phases 1–6; YouTube verification (parallelizable).
**Effort:** 2.5–3 weeks (resumable upload + ffprobe-based preflight; both proven patterns we already need elsewhere).
**Risks:** Verification timeline (CASA cost + scheduling); per-project quota cap on burst uploads — surface clearly, document raising it.
**NOT in scope:** Live streams, community tab posts, comment moderation, Shorts-specific Reels-cross-posting, Studio analytics.

## Phase 11 — Pinterest extras (post-7.5)

**Status:** Core publish path subsumed by Phase 7.5 (board fetch on connect, default-board with per-post override, image pin via `media: [{ kind: "image", url | mediaId }]`). What remains here is the long tail.

**Ships:**
- Video pin support — Pinterest accepts MP4 via `cover_image_url` + media; preflight on duration / resolution / size
- Rich pins (article / product) — schema.org markup + URL preflight
- Board ownership preflight (verify the user can pin to the supplied `boardId` before hitting Pinterest's API)
- Pinterest-specific error mapper polish — duplicate-pin, board-deleted, content-policy
- Standard Access submission (the demo-video gate)

**Depends on:** Phase 7.5.
**Effort:** 2–3 days plus Standard Access wait.
**Risks:** Low — image MVP is already proven by 7.5.
**NOT in scope:** Catalog/feed sync, ads, idea pins.

## Phase 12 — OpenAPI Pipeline, TS SDK, Autogen'd Python + Go

**Goal:** Three SDKs ready to publish.

**Ships:** `packages/openapi` — Zod → OpenAPI 3.1 generation wired into CI; `packages/sdk-ts` — hand-rolled thin fetch wrapper with typed clients per resource, idempotency-key helper, webhook signature verifier, typed error classes per error code, retry/backoff, streaming helpers for media; Changesets → `@letmepost/sdk` on npm; `sdk-sync.yml` GitHub Action regenerates Python (`openapi-python-client` / `datamodel-code-generator` + httpx) and Go (`oapi-codegen`) into sibling repos on OpenAPI change; both generated SDKs get a thin hand-written façade layer so the public API feels designed, not generated; smoke tests in all three SDKs hit a mock server.

**Problems solved:** Enabling (ships DX).
**Principles served:** 6, 7.
**Depends on:** Phase 6 minimum — API shape stable enough to freeze.
**Effort:** 2 weeks TS + 1 week Py/Go generators = 2.5–3 weeks combined. Py/Go can lag v1 if scope demands.
**Risks:** Autogen façade is where quality dies. Budget naming-polish time.
**NOT in scope:** CLI, MCP adapter, LangGraph / CrewAI adapters.

## Phase 13 — Marketing + Docs Site (Major Phase)

**Goal:** The site is a product surface. SEO is a core bet. Docs are a principle.

**Docs narrative starts at week 3** (drip 1–2h/day from Phase 1 onward). Weeks 24–26 are for polish, Scalar integration, SEO, and information architecture — **not for writing from scratch**. Error-code and preflight-rule pages should publish incrementally so Google indexes them months ahead of launch.

**Ships in `apps/web` (Astro + Starlight + Scalar, single deploy):** Landing (hero + "fails loudly" positioning + live preflight-failure demo + platform matrix + pricing + OSS CTA); Docs in Starlight (getting started with cURL + TS + Python + Go tabs on every example; authentication; API keys; idempotency; errors; webhooks; OAuth lifecycle; **one page per error code** with reproduction + remediation; **one page per preflight rule** with upstream platform citation; per-platform guides; migration guides from Ayrshare / Postiz / Buffer); **Public API Version Tracker** consuming `/v1/platform-versions`; API Reference via Scalar; Changelog fed from Changesets; Lighthouse 100 enforced in CI; OG-image generation per doc page; structured-data JSON-LD; unified sitemap; blog with the 4 launch posts (LinkedIn version-churn piece is the flagship).

**Problems solved:** All indirectly (this is where the narrative lives).
**Principles served:** 5, 6, 7.
**Depends on:** Phase 12 for the reference; narrative can start at week 3.
**Effort:** 3 weeks of concentrated work + continuous background writing.
**Risks:** Writing quality is the bottleneck. Do not outsource. Pull content from the existing research corpus.
**NOT in scope:** Community forum, interactive playground beyond the preflight demo, multilingual.

## Phase 14 — Observability, Security, Launch Prep, Pricing Decision

**Goal:** Don't get embarrassed on HN day.

**Ships:** Sentry + Axiom dashboards with saved queries for the top 10 operational questions; structured audit log for account-connect and key events; secret-scanning in CI (gitleaks); Dependabot; SBOM; `RateLimit-*` response headers per RFC; status page (simple — Statuspage or self-rolled Astro page reading a check endpoint); k6 load test against staging to establish baseline and tune BullMQ concurrency; security review of token-encryption + webhook-signature paths (ideally a second pair of eyes); Terms / Privacy / Apache-2.0 LICENSE / CONTRIBUTING / SECURITY.md; self-host Docker Compose story working end-to-end (same API, same code); **n8n community node** scaffolded; **pricing decision locked** (flat tier shape, free tier size, overage model).

**Problems solved:** 1 (observability), 5 (pricing resolution), enabling.
**Principles served:** 5, 7.
**Depends on:** Everything prior.
**Effort:** 1.5 weeks.
**Risks:** Self-host Docker tends to have one surprise (Redis URL format, cert trust). Leave a day. Pricing decision should not drag — decide even imperfectly rather than delay launch.
**NOT in scope:** SOC 2, HIPAA, BAAs.

## Phase 15 — v1 Public Launch

**Goal:** Ship.

**Ships:** Announcement (HN, Bluesky, LinkedIn, Twitter/X); launch blog post (LinkedIn version-churn piece as hook); Show HN; DM outreach to n8n / Make / Zapier community-node maintainers; Product Hunt scheduled +7 days; n8n community node published.

**Depends on:** Phases 1–14.
**Effort:** 1 week.
**Risks:** Comment response load on launch day.

---

## Parallelism Map

| Week | Primary track | Background |
|---|---|---|
| Day 0 | — | Submit: Meta, YouTube CASA, X, LinkedIn MDP, Pinterest |
| 1–2 | Phase 1: Persistence | External reviews in queue |
| 3–4 | Phase 2: Auth + API keys | Docs narrative drafts begin (continuous from here) |
| 5–6 | Phase 3: Idempotency + errors + obs wiring | Error-code registry docs drafts |
| 7–8 | Phase 4: Queue + webhooks | — |
| 9–10 | Phase 5: OAuth framework + Bluesky migration | LinkedIn preflight rule docs authored |
| 11 | **Phase 5.5: Profiles (retrofit)** | — |
| 12–14 | **Phase 6: LinkedIn (3 wks)** | TS SDK skeleton stubbed in week 14 |
| 15–16 | Phase 7: Dashboard | TS SDK continues |
| 17 | **Phase 7.5: Media + S3 + Bluesky/Pinterest hardening (1 wk)** | — |
| 18–19 | Phase 8: X (now gated on paid-tier signup) | Py/Go generators |
| 20–22 | **Phase 9: Meta trio (3 wks, gated on approval)** | If Meta not yet approved, swap in Phase 11 extras + Phase 13 docs |
| 23–25 | Phase 10: YouTube (build during CASA verification) | Same swap rule |
| 26 | Phase 11: Pinterest extras (video pins, rich pins, board ACL preflight) | — |
| 27–29 | **Phase 13: Site + docs polish (3 wks)** | Contract test cron stabilization |
| 30 | Phase 14: Obs + security + launch prep + pricing | — |
| 31 | Phase 15: Launch | — |

Note: weeks 26–28 count as the *polish* window for docs, assuming the continuous-drip rule worked. If not, add 1–2 weeks. Realistic ship window: **7–8 months from Day 0**, accounting for Meta App Review + YouTube CASA verification variance.

**Strictly sequential:** 1 → 2 → 3 → 4 → 5 → 5.5 → 6 → 7 → 7.5.
**Can parallelize:** Phase 7 (dashboard) with Phase 8 (X) and Phase 12 (SDKs).
**Calendar-gated:** 9 (Meta App Review), 10 (YouTube CASA verification) — build readiness, deploy same-day on approval.
**Always-background:** Docs narrative (Phase 13).

---

## Explicitly deferred to v2+ (scope lock)

The following will be asked for. The answer is "not in v1":

- **Inbox surfaces** — comments, DMs, reviews, comment-to-DM automations. Entire product line for v2.
- **Ads manager** across Meta/Google/YouTube/TikTok/LinkedIn/Pinterest/X. Separate product line.
- **WhatsApp Business** (templates, flows, phone numbers, groups). Separate product line.
- **CRM-ish features** — contacts, sequences, broadcasts.
- **TikTok** — deferred to v2. The Content Posting API has two separate audits (Upload + Direct Post), each on a 4–10-week manual review with frequent rejections, and the SELF_ONLY constraint complicates the public demo path. Will revisit once v1 is shipped and the platform churn rate is understood. Schemas + DB enum keep `tiktok` reserved so the v2 add is additive, not a migration.
- **Reddit, Telegram, Discord, Snapchat, Google Business**
- **Advanced media ops** — image editing, video trimming, auto-captioning, thumbnail generation.
- **Team-management UI** beyond single-org multi-member.
- **Analytics dashboards** beyond post-log + error-log.
- **Whitelabel / agency tier UI.**
- **Per-profile / per-seat pricing** — actively rejected, not just deferred. Profiles exist in v1 as a free org-structure primitive. Pricing stays flat at the org level. Revisiting this is a PRODUCT.md-level decision, not a roadmap one.
- **Per-profile custom branding, per-profile webhook endpoints, cross-profile account sharing** — explicitly out of the Phase 5.5 profiles slice; revisit only if a paying customer asks.
- **MCP server, LangGraph adapter, CrewAI adapter** — identified as differentiators but not v1. Could slot in as Phase 15.5.
- **Ayrshare SDK drop-in adapter** — migration lever, but not v1.
- **SOC 2, HIPAA, BAAs** — when a customer pays for them.

---

## Critical files for implementation

- `apps/api/src` — Hono app root. Every endpoint, middleware, and platform publisher wires here. Phases 2–11 all touch it.
- `packages/schemas/src` — Zod source of truth. Every phase adds to it. Feeds OpenAPI in Phase 12 and docs in Phase 13.
- `TECH.md` — stack contract. Any deviation must be justified against it.
- `PRODUCT.md` — principles contract. Every phase's "principles served" line maps back here.
- `turbo.json` — pipeline root. Needs updates as `apps/dashboard`, `apps/web`, `packages/openapi`, `packages/sdk-ts`, `packages/ui` land.

---

## Verification

The v1 launch is shippable when:

1. All phases' "Ships" items are green (1, 2, 3, 4, 5, 5.5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15).
2. **End-to-end smoke test passes for all 8 platforms:** Bluesky, LinkedIn, Twitter/X, Instagram, Facebook, Threads, YouTube, Pinterest — each publishes a real post through the hosted API with idempotency + webhooks + error mapping verified.
3. **Contract tests green on cron** for every platform (real API, not MSW) for 7 consecutive days.
4. **Profile isolation verified:** an API key scoped to Profile A cannot read, publish from, or modify accounts in Profile B within the same org. Cross-profile access 404s (not 403) to avoid leaking existence. Org-wide keys keep working against any profile.
5. **Post Log renders the full error contract** for every failure class (`preflight_failed`, `platform_rejected`, `platform_auth_failed`, `platform_unavailable`, `validation_failed`, `internal_error`), with the raw platform response visible and copy-as-curl on every row.
6. **Docs parity check:** every error code in `packages/schemas` has a docs page; every preflight rule has a docs page with upstream citation; every endpoint has runnable examples in all 4 language tabs.
7. **SDK parity:** TS SDK published, Py/Go SDKs generated and published to PyPI + pkg.go.dev; smoke tests green in each.
8. **Self-host parity:** `docker compose up` works end-to-end against a fresh Postgres + Redis; same API responses as hosted.
9. **Lighthouse 100** on all marketing + docs pages (mobile + desktop).
10. **Load test:** API handles 500 req/s sustained on a single Railway instance with p95 < 250ms (excluding upstream platform latency).
11. **Pricing page live** with committed tier shape — flat at org level, profiles free.
12. **n8n community node published** and linked in docs.
