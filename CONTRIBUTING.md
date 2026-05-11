# Contributing to letmepost.dev

A short, opinionated guide. The goal is consistency: when the second person touches the code, they should write the same shape as the first.

This doc captures patterns that are already working. Anything not in here is fair game to invent — but if you find yourself fighting the codebase, you're probably fighting one of these rules.

---

## 1. The error contract is load-bearing

Every error a caller sees is a `LetmepostError` (`apps/api/src/errors.ts`) serialized to:

```json
{
  "error": {
    "code":             "preflight_failed | platform_auth_failed | platform_rejected | platform_unavailable | validation_failed | not_found | unauthenticated | unauthorized | rate_limited | internal_error",
    "rule":             "bluesky.text.max_graphemes",
    "platform":         "bluesky",
    "platform_version": "atproto-2026-04",
    "platform_response": { /* raw upstream body */ },
    "remediation":      "Shorten the post to 300 graphemes or fewer.",
    "request_id":       "req_…",
    "trace_id":         "…"
  }
}
```

**Why this matters:** the entire product wedge is "fails loudly." Empty `{}` errors are the failure mode we exist to prevent. Every error path must produce a populated `LetmepostError`.

**Rules:**
- Throw `LetmepostError`, never raw `Error`, in any code path that can reach the HTTP boundary.
- Always populate `rule`, `platform`, and `remediation` when they apply. The dashboard's Post Log renders these directly — empty fields make it useless.
- Always preserve the raw upstream body in `platformResponse`. Never drop it. The integrator needs it to debug.
- Zod parse failures get coerced into `LetmepostError(code: "validation_failed")` inside `zValidator` callbacks. The `rule` is the dotted path of the failing field.
- The two boundary helpers in `platforms/_shared/errors.ts` — `authFailed()` and `rejected()` — are how upstream client code constructs errors. Use them. Don't hand-roll.

---

## 2. Layering: publishers / clients / repositories / middleware / routes

The `apps/api/src` layout reflects strict layering. Cross-talking is forbidden:

| Layer | What goes here | Doesn't talk to |
|---|---|---|
| `routes/*` | Hono handlers, request validation, dispatch | Upstream HTTP (use clients) |
| `middleware/*` | Composable per-request concerns (auth, idempotency, rate limit, profile scope) | DB other than via `c.var.db` |
| `repositories/*` | All DB reads/writes; transparent token decryption | Upstream HTTP, route concerns |
| `platforms/<name>/client.ts` | Raw HTTP to one upstream platform; OAuth helpers | DB, our error contract — wait, scratch that, *does* surface our `LetmepostError` via `authFailed`/`rejected` helpers |
| `platforms/<name>/publisher.ts` | Preflight + bytes resolution + client orchestration; produces a `CreatePostResponse` | DB |
| `platforms/<name>/preflight.ts` | Pure validators only — no network, no DB | Anything else |
| `platforms/<name>/provider.ts` | Implements `AccountProvider` (describeConnect / completeConnect / refreshToken) | The publisher (deliberately decoupled) |
| `platforms/_shared/*` | Patterns shared across platforms (dispatch, media, http, errors, scopes) | Specific platform code |

**Do not** import a route from a publisher. **Do not** call a client directly from a route — go through the publisher. **Do not** put Zod parsing in middleware. If you find yourself wanting to break a layer, write it down here as a counter-rule and we'll discuss.

---

## 3. Adding a platform

There's one entry point that needs to know about a new platform:

1. Add it to `packages/schemas/src/platforms.ts` `Platform` enum.
2. Add a scope set entry in `apps/api/src/platforms/_shared/scopes.ts` (narrow-by-default — `write` is the minimum to publish; `extended` is opt-in).
3. Build `platforms/<name>/{client,preflight,provider,publisher}.ts` mirroring an existing platform. Bluesky is the credentials reference; Twitter is the OAuth-PKCE reference; LinkedIn is the OAuth-classic reference; Pinterest is the simplest OAuth.
4. Register the provider in `platforms/index.ts` (one line).
5. Add a `case` in `platforms/_shared/dispatch.ts` `publishForAccount()` — this is the *only* dispatch site. Both the synchronous route and the scheduled-post worker route through it.
6. Tests: `tests/posts-<name>.test.ts`, `tests/preflight-<name>.test.ts`, `tests/provider-<name>.test.ts`. See §5.

If you're touching `routes/posts.ts` or `queue/worker.ts` to add a platform, **stop** — that's a sign the dispatch refactor regressed. Open `_shared/dispatch.ts` instead.

---

## 4. The provider registry vs the publisher dispatch (they're separate on purpose)

- **`AccountProvider` registry** (`platforms/_shared/provider.ts` + `platforms/index.ts`) — owns *account lifecycle*: connect descriptor, complete connect, refresh token. Looked up by string platform name; routes use `getProvider(platform)`.
- **`publishForAccount(account, input)`** (`platforms/_shared/dispatch.ts`) — owns *post publishing*. A typed switch because per-platform input shapes are load-bearing on types (Pinterest needs `boardId`, Bluesky cares about `firstComment`, etc.). A registry-callback would erase the type info.

Don't try to merge them. They solve different problems and the type ergonomics differ.

---

## 5. Test pattern

Every endpoint and every publisher gets:
- **Happy path** — the canonical "everything works."
- **Auth failure** — `platform_auth_failed` from the upstream maps to a `post.rejected` event and a 401.
- **Platform rejection** — `platform_rejected` (e.g. duplicate, content rule) → `post.rejected` + appropriate 4xx/5xx.
- **Preflight failure** — local validator fails → 400, **no upstream call**. Assert `upstreamCalls === 0`.
- **Network/timeout** — `platform_unavailable` → `post.failed` event + 503.
- **Idempotency** (write endpoints only) — same `Idempotency-Key` returns the cached response; different body with same key is a 409.
- **Rate-limit** (write endpoints only) — 429 with `RateLimit-*` headers per RFC.

**Mechanics:**
- MSW (`setupServer`) intercepts every upstream HTTP call. Tests **must** set `onUnhandledRequest: "error"` so a forgotten mock fails loudly instead of hitting the real network.
- DB tests run inside `runInTransaction(tx, …)` — every test rolls back. No truncate, no shared state.
- Test seeds use `seed(tx)` from `db/seed.ts` — it creates org + user + member + Default profile + API key + a Bluesky account in one call. Use it.
- Webhook events are captured via a stubbed `WebhookDispatcher` passed to `createApp({ webhookDispatcher })`. Don't touch BullMQ in tests.
- Provider tests call the provider class directly with overridden `tokenUrl` / `apiBase` pointed at MSW — no DB needed.

---

## 6. Idempotency

`apps/api/src/middleware/idempotency.ts` enforces the contract on every write:
- 24-hour replay window.
- Same key + same body → return the stored response.
- Same key + different body → 409.
- 5xx responses are **not** stored — retries are expected to retry.
- Implementation note: the body fingerprint is a SHA-256 of the canonical JSON. Don't bypass.

If you write a new `POST` / `PUT` / `PATCH` / `DELETE` route, you almost certainly want `idempotency()` in the middleware chain. The exception is "the action is naturally idempotent" (e.g. session token refresh) — document the exception in the route's comment if you skip it.

---

## 7. Migrations are idempotent

Drizzle generates `0000_*.sql`, `0001_*.sql`, `…`. Two rules:
- **Don't** edit a migration after it's been applied to any environment — it changes the hash, drizzle re-applies, things break in confusing ways.
- **Do** write migrations idempotent-by-default: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `INSERT … ON CONFLICT … DO NOTHING`, `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …) THEN ALTER TABLE … END IF; END $$`. The Phase 5.5 profiles migration (`drizzle/0002_silly_microbe.sql`) is the reference.

For data backfills: use `gen_random_uuid()` in SQL when you need a UUID, since drizzle's `uuidv7()` is JS-only.

---

## 8. Commits

Match the existing log style:

```
$ git log --oneline
linkedin: mvp publisher + oauth provider (personal-only, w_member_social)
profiles: workspace primitive + api-key scope + lifecycle event payload
pinterest + twitter: mvp publishers, oauth providers, preflight
accounts: provider framework + /v1/accounts + refresh scheduler
```

Rules:
- One-line subject. `scope: short imperative description`. Lowercase. No period.
- No body unless the commit needs one for archaeology — usually it doesn't; the diff and the PR description carry the reasoning.
- Backend commits (api, schemas, db, workers, platforms): no `Co-Authored-By` trailer.
- Frontend commits (web, dashboard): keep the `Co-Authored-By` trailer.

---

## 9. Where to put new things

| You're adding… | Goes in… |
|---|---|
| A new error code | `apps/api/src/errors.ts` (`ErrorCode` union) + a docs page (Phase 13) |
| A new endpoint | `apps/api/src/routes/<resource>.ts` mounted from `app.ts` |
| A new DB table | `apps/api/src/db/schema/<name>.ts`, exported from `schema/index.ts` |
| A new public schema | `packages/schemas/src/<name>.ts`, exported from `index.ts` |
| A new platform | See §3 |
| A new shared platform helper | `apps/api/src/platforms/_shared/<name>.ts` |
| A new test | `apps/api/tests/<topic>.test.ts` — flat layout, no nesting |
| A new dashboard component | `apps/dashboard/src/components/app/<name>.tsx` (app-specific) or `components/ui/*` (shadcn primitive) |
| A new dashboard analytics event | Add a variant to `DashboardEvent` in `apps/dashboard/src/lib/analytics.ts`; fire via `track()` |
| A new marketing analytics event | Add a variant to `WebEvent` in `apps/web/src/lib/analytics.ts`; fire via `track()` or `data-analytics-event` |
| A new PostHog identify/group call | `apps/dashboard/src/components/app/posthog-provider.tsx` — nowhere else |

---

## 10. Things deliberately not done

- **Per-profile billing** — explicitly rejected. Profiles are an org-structure primitive; pricing stays flat.
- **Per-platform `if`-soup at the route layer** — every cross-platform branch belongs in `_shared/*`.
- **Comments that describe the what** — the code already says what. Comments are for the *why* (a non-obvious constraint, a workaround, a hidden invariant). Concrete example: `capture_pageview: false` in `posthog-provider.tsx` earns a comment because removing it would silently double-count pageviews; the line itself doesn't reveal why.
- **File-header docstrings that summarize the module** — paragraph-long "this file's three responsibilities" blocks don't earn their keep. One-line whys do.
- **Duplicated/shadowed unions kept in sync by comment** — import the canonical type or extend it. A comment is not a substitute for `import`.
- **Backwards-compatibility shims for unused code** — delete it; we're pre-launch. After launch this rule flips.

---

## 11. Analytics events

Both apps emit PostHog events through a typed `track()` helper. The wiring is intentionally narrow.

- **Types live in one place per app.** `apps/dashboard/src/lib/analytics.ts` and `apps/web/src/lib/analytics.ts` each export a discriminated union of every event their app fires. Never re-declare `Platform`, `OnboardingStep`, or any other narrow alias inline at a callsite — import the type, or extend the union. Drift = events get dropped silently.
- **Fire through `track()`.** No `as any` / `as never` to make a callsite compile — fix the union or narrow at the boundary (`asAnalyticsPlatform()`, `asOnboardingStep()` already exist for this).
- **PostHog stays optional.** `track()` no-ops when `NEXT_PUBLIC_POSTHOG_KEY` / `PUBLIC_POSTHOG_KEY` is unset, so local dev is quiet by default. Don't add guards at callsites — `track()` already has the right one.
- **Event names follow `noun.verb_past`.** Same convention as the webhook event catalog (`post.queued`, `account.connected`, `version.deprecated`) so client and server events compose without collision.
- **Ordering matters.** `*.started` / `*.sent` fire **before** the awaited call; `*.completed` / `*.succeeded` fire **after**. Don't count work that hasn't happened — a failed `authClient.signOut()` shouldn't appear in PostHog as a successful sign-out.
- **Marketing site declarative form.** `data-analytics-event="<name>"` + `data-analytics-props='{...}'` on `<a>`/`<button>` is fine — no React tree to wire props through. The strings on both sides must match a `WebEvent` union member; that's the typed boundary.
- **One identify site.** `posthog.identify()` and `posthog.group()` calls live in `apps/dashboard/src/components/app/posthog-provider.tsx` only. Don't sprinkle them across components.
- **Commit-trailer rule applies.** §8: analytics changes touching `apps/web` or `apps/dashboard` keep the `Co-Authored-By` trailer; an analytics change that also touches `apps/api` drops it (backend rule wins on cross-cutting commits — easier than splitting).

---

## What this document is not

This is a working snapshot. As the second platform proved patterns wrong (it did, in small ways) the third and fourth might too. When you find yourself writing code that doesn't match anything here, that's a signal to either (a) update this file, or (b) refactor toward the existing pattern. Both are fine; just pick one.
