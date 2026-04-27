# letmepost.dev

> A publishing API that fails loudly.

Open-source social media publishing API for developers and AI-agent builders. Every failure response carries the rule that failed, the raw platform body, and a remediation — never an empty `{ body: {} }`. No per-profile tax.

**Status — alpha.** Bluesky works end-to-end. LinkedIn next. Meta and YouTube are review-gated by the platforms (3–12 weeks). See [`plan.md`](./plan.md).

[letmepost.dev](https://letmepost.dev) · [`PRODUCT.md`](./PRODUCT.md) · [`TECH.md`](./TECH.md) · [`plan.md`](./plan.md)

---

## Why this exists

Four things developers hit every week with incumbent social-media APIs:

1. **Silent failures.** Posts report success then never appear. Error bodies come back as `{}`.
2. **API version churn.** LinkedIn sunset five API versions in six months; every sunset broke n8n, Zapier, Make, Pabbly, and Postiz.
3. **Async media rejections.** YouTube's restricted-scope mismatches surfacing as generic `forbidden`, Threads' `OAuthException 2207052`, Instagram Reels rejecting Google Drive URLs — all catchable client-side.
4. **Per-profile pricing.** $6–12 per channel, per month, forever.

letmepost.dev addresses all four, in one API.

## Four guarantees on every request

1. **Preflight, not postflight.** Character counts, media formats, URN patterns, audit states — all validated locally before the upstream call.
2. **Transparent errors.** Stable code + the rule that failed + the raw platform body + a remediation hint. Always.
3. **Pinned platform versions.** We pin the header, track deprecations, upgrade internally. Your workflow doesn't break at 2 a.m.
4. **Idempotency by default.** Every write accepts an `Idempotency-Key`. Retries are safe.

## The shape

Request:

```bash
curl -X POST https://api.letmepost.dev/v1/posts \
  -H "Authorization: Bearer lmp_live_…" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "account": { "platform": "bluesky", "id": "acc_…" },
    "text": "Shipping letmepost.dev"
  }'
```

Failure:

```json
{
  "error": {
    "code": "preflight_failed",
    "rule": "bluesky.text.max_graphemes",
    "platform": "bluesky",
    "platform_version": "atproto-2026-04",
    "message": "Post text is 312 graphemes; Bluesky allows at most 300.",
    "remediation": "Shorten the post to 300 graphemes or fewer.",
    "request_id": "req_01HY6X4AWBJM2K9F2PTQMRD9JQ"
  }
}
```

Same shape, every time.

## Running locally

**Prerequisites**

- Node `>=24` (see [`.nvmrc`](./.nvmrc))
- pnpm `10.33.0+` (`corepack enable` if you don't have it)

**Install and run**

```bash
pnpm install
pnpm dev            # API + web in watch mode (turbo)
pnpm test           # vitest across the workspace
pnpm typecheck
pnpm build
```

**Individual apps**

```bash
pnpm --filter @letmepost/api dev     # API only → http://localhost:3000
pnpm --filter @letmepost/web dev     # Landing site → http://localhost:4321
```

## Repo layout

```
apps/
  api/                 # Hono HTTP API — core product
  web/                 # Astro landing site (letmepost.dev)
packages/
  schemas/             # Zod — single source of truth for validation, types, OpenAPI
  config-tsconfig/
  config-eslint/
```

Landing later as the stack grows: `apps/dashboard/` (Next.js), `packages/openapi/` (generated 3.1 spec), `packages/sdk-ts/` (published to npm), plus sibling repos `letmepost/sdk-python` and `letmepost/sdk-go` auto-generated from the spec. See [`TECH.md`](./TECH.md) for the full target tree.

## Platform support

| Platform | Status |
|---|---|
| Bluesky | live |
| LinkedIn | next (~3 weeks) |
| Twitter / X | soon |
| Instagram · Facebook · Threads | soon (Meta review starts day 0) |
| YouTube | later (CASA verification starts day 0) |
| Pinterest | later |

TikTok is deferred to v2 — schemas + DB enum keep it reserved so the v2 add is additive. Deliberately cut from v1: Reddit, Telegram, Discord, Snapchat, Google Business, WhatsApp. Reasoning in [`PRODUCT.md`](./PRODUCT.md).

## Contributing

Building in the open. [File an issue](https://github.com/rosekamallove/letmepost.dev/issues) when something's weird; read [`PRODUCT.md`](./PRODUCT.md) before PRs that touch product surface area and [`TECH.md`](./TECH.md) for implementation decisions.

## License

Apache 2.0. Same code runs the hosted SaaS and the self-host Docker Compose — no feature gate, no open-core trick.
