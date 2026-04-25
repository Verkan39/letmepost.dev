# Dashboard TODO

Persistent backlog for `apps/dashboard`. Resume from here after `/compact`.

---

## Where we are

**Working:** sign-in/up, org creation on sign-up, sidebar nav (Dashboard / Post log / Accounts / API keys / Webhooks), accounts connect (oauth + credentials), api-keys CRUD, webhooks CRUD, post log list + detail.

**Theme:** matches landing — paper cream + forest green + Commit Mono, sharp corners. (Not Really)

**Auth:** session cookies cross-origin (api on :3000, dashboard on :3001). `apiKeyOrSession()` middleware lets `/v1/posts` GET accept either auth.

**Build:** clean. 11 routes generated.

---

## Bugs (do first)

### 1. Orphaned-session 403s
**Symptom:** dashboard pages 403 with `{ code: "unauthorized", message: "No active organization on this session." }`.
**Cause:** `requireSession()` and `apiKeyOrSession()` both throw 403 when the better-auth session has no `activeOrganizationId`. Sign-up's create-org-then-set-active sequence can leave a session in this state if anything between the two steps fails.
**Fix paths:**
- Add an `/onboarding` route the dashboard redirects to whenever `useActiveOrganization()` returns null. Lets the user create / pick an org without signing out.
- In `(app)/layout.tsx`'s `AuthGuard`, redirect to `/onboarding` on `session && !activeOrg` rather than letting downstream pages 403.
- Make sign-up's org-create+setActive atomic: if either step fails, sign the user out cleanly and surface the error.

### 2. Stale platform list
**File:** `apps/dashboard/src/lib/accounts.ts:56`
**Issue:** `CONNECTABLE_PLATFORMS` is hardcoded to `["bluesky", "pinterest", "twitter"]` — LinkedIn is missing even though it's in `@letmepost/schemas` Platform enum.
**Fix:** import `Platform` from `@letmepost/schemas` and derive the list. Same fix flushes future platforms automatically.

### 3. Post log: linkedin appears twice in the platform filter
**File:** `apps/dashboard/src/app/(app)/posts/page.tsx`
**Issue:** the dropdown both spreads `CONNECTABLE_PLATFORMS` and explicitly adds `<SelectItem value="linkedin">linkedin</SelectItem>` as a workaround. Once #2 is fixed, drop the explicit entry.

### 4. `window.prompt()` for new-org in sidebar
**File:** `apps/dashboard/src/components/app/app-sidebar.tsx`
**Issue:** the "New organization" item in the org switcher uses `window.prompt()` — ugly, no validation, no slug preview.
**Fix:** swap to a shadcn `Dialog` with name + slug fields, mirror the sign-up flow.

### 5. The divider in the header (the breadcrumb header) between the sidebar collapse icon and the workspace name is not rendered correctly

### 6. API Key creation form - Enviorment dropdown is not aligned with the form input

### 7. webhook creation form: the parent div of the CTA doesn't have top margins, so so it is looks weird with the form inputs.

### 8. There is no onboarding, these are the steps for the onboarding
- Copy your api key
- Conenct your first platform 
- go to dashboard with a quick start guide button as the main thing

---

## Phase 5.5 Profiles work (API done, dashboard not)

The profiles API (`/v1/profiles`) is live, profile-scoped API keys exist, posts/accounts respect profile scope. Dashboard exposes none of it.

### 5. `/profiles` CRUD page
**File:** new `(app)/profiles/page.tsx`
**Shape:** mirrors `/api-keys` and `/webhooks` — list, create (name + auto-derived slug), rename, delete (refuse with 409 if non-empty — surface that as an inline error).

### 6. Profile switcher in sidebar
**File:** `app-sidebar.tsx`
**Shape:** add a second dropdown below the org switcher — "Working in: <profile name>". Persist the active profile in localStorage (no server-side concept yet).
**Implication:** every page that lists/creates per-profile resources reads the active profile from a `useActiveProfile()` hook.

### 7. Profile selector on Connect Account
**File:** `(app)/accounts/new/page.tsx`
**Issue:** complete-connect always defaults to "Default" profile. Need a profile picker so agencies can connect a client account into the right profile.
**Fix:** add a `<Select>` of profiles before the platform picker; pass `profileId` in the body of `/v1/accounts/connect/:platform/complete`.

### 8. Profile-scope selector on API Keys create
**File:** `(app)/api-keys/page.tsx`
**Issue:** keys are always created org-wide. The API supports `profileId` on key create — UI doesn't expose it.
**Fix:** add a `<Select>` "Scope: org-wide / profile X / profile Y" before the create button. Show the scope on each row in the list.

### 9. Profile filter on Post Log
**File:** `(app)/posts/page.tsx`
**Issue:** API supports `?profileId=` but UI doesn't expose it.
**Fix:** add a profile dropdown next to platform/status, default to active profile.

---

## Post Log gaps (Phase 7 spec)

### 10. Time-range filter
After + before query params exist on the API. UI should expose a "Last 24h / 7d / 30d / custom" picker. Default: 30 days.

### 11. Error-code filter
API supports `?errorCode=`. UI should add a multi-select populated from a static list of canonical codes (`platform_auth_failed`, `platform_rejected`, `preflight_failed`, `platform_unavailable`, `validation_failed`, `internal_error`).

### 12. Search by post text
API doesn't support this yet. **Backend ticket first:** add `?q=` to `/v1/posts` (Postgres `ILIKE` on `posts.text` is fine for v1; trgm or full-text later).

### 13. Live updates
Currently manual refresh only. Cheapest path: refetch on window focus + a manual "Refresh" button on the list. Polling is overkill until users complain.

### 14. Detail page: copy-as-curl polish
**File:** `(app)/posts/[id]/page.tsx`
**Issue:** the curl block uses placeholder `lmp_live_…` — fine, but it could prompt the user to pick from their actual keys list and inject one (read-only, redacted).
**Issue:** doesn't include `media`, `firstComment`, `scheduledAt` if they were on the original post.

### 15. Empty state CTA on the list
**File:** `(app)/posts/page.tsx`
**Issue:** "No posts yet" with a one-liner. Should include a curl + TS snippet to send the first post, plus a link to docs (when Phase 13 lands).

---

## Webhooks page gaps

### 16. Event-type multi-select
**File:** `(app)/webhooks/page.tsx`
**Issue:** events are entered as free-text comma-separated — easy to typo `post.publishd`. Use a multi-select bound to `WEBHOOK_EVENT_TYPES` from `@letmepost/schemas`.

### 17. Test-deliver button
**Backend ticket first:** add `POST /v1/webhook-endpoints/:id/test` that fires a synthetic event. Then surface a "Send test event" button per row.

### 18. Delivery log per endpoint
**Backend ticket first:** the delivery history exists in BullMQ but isn't queryable. Need a `webhook_deliveries` table or BullMQ → DB sync. Defer until users ask.

### 19. Rotate signing secret
**Backend ticket first:** `POST /v1/webhook-endpoints/:id/rotate-secret`. Then a "Rotate" button per row (with `ConfirmDialog`) that shows the new secret once.

---

## API Keys page gaps

### 20. Show key scope on the list
**File:** `(app)/api-keys/page.tsx`
**Issue:** rows don't show whether the key is org-wide or profile-scoped. Add a badge.

### 21. Last-used timestamp
The API records `lastUsedAt`. Show "Used 3m ago" per row.

### 22. Per-key detail page
Optional. Click a row → page that shows scopes, last-used, audit timeline (when added).

---

## Accounts page gaps

### 23. Reconnect-near-expiry CTA
**File:** `(app)/accounts/page.tsx`
**Issue:** rows show a token-expiry timestamp but no action. Add a "Reconnect" button when expiry is within 7d (the `expiringHorizonMs` for OAuth platforms).

### 24. Pinterest per-post fields editor
**Issue:** Pinterest MVP stashes `boardId` / `destinationUrl` / `imageUrl` in `tokenMetadata` (documented hack — Phase 11 follow-up moves them to `CreatePostRequest`). For now the only way to set them is a direct DB write. Either:
- Add a "Pinterest defaults" form on the account detail (writes to `tokenMetadata`), OR
- Just accelerate the Phase 11 follow-up and skip the dashboard hack.

### 25. Account detail page
Optional. Click an account → see platform-specific metadata, scope list, recent posts (filter post log by account).

---

## Onboarding / home

### 26. First-run checklist
**File:** `(app)/page.tsx`
**Shape:** the landing screen shouldn't be three count-cards — for a first-time org with 0 of everything, show:
1. ⬜ Connect an account
2. ⬜ Create an API key
3. ⬜ Send your first post (with a copy-pastable curl)
4. ⬜ (optional) Subscribe to a webhook

Each step links to its surface; checks itself off based on the count.

### 27. Recent failures card on home
For an org with activity, show "5 failed posts in the last 24h" linking to the post log filtered to `status=failed`.

---

## Visual / UX polish

### 28. Dark mode
The `.dark` block in `globals.css` is left at shadcn defaults (oklch grayscale) — doesn't match the cream/forest light theme. Either build a proper dark palette (e.g. dark-paper + lighter forest) or disable dark via `<html class="light">` and remove the toggle.

### 29. Empty-state design pass
Every list screen has a `<Card>` with a one-liner. Should be more inviting — illustration / CTA / "first post" snippet where relevant.

### 30. Mobile layout
Untested. Sidebar is responsive (shadcn defaults) but no QA on actual screen sizes.

### 31. Toaster placement
Currently `top-right`. Inline form errors would be better than toasts for validation failures.

### 32. Loading state heights
`<Skeleton>` heights are inconsistent (h-14 vs h-16 vs h-24 across pages) — pick one per row-type and stick with it.

### 33. ConfirmDialog usage
Currently used on accounts/api-keys/webhooks delete. Should also wrap:
- Sign out (low risk, but it's destructive of session state)
- Profile delete (when #5 lands)
- Endpoint pause/disable (when added)

---

## Data fetching

### 34. SWR or react-query
Currently every page does `useEffect → fetch`. No refetch-on-focus, no shared cache, no optimistic updates. Adding SWR would clean up `accounts/page.tsx`, `api-keys/page.tsx`, `webhooks/page.tsx`, `posts/page.tsx`. Worth it once 5+ pages share data.

### 35. Inline form errors
Most submits surface errors via toast. Sign-up should show inline ("Email already in use") next to the field. shadcn's `<Form>` + react-hook-form is the canonical way; we deferred it (`form` was deliberately skipped per the dashboard agent's report).

---

## DX / infra

### 36. Storybook or component preview
Not blocking. Useful when the design surface gets large enough that visual regressions matter.

### 37. e2e tests
Playwright against the dashboard would catch the 403 issue (#1) immediately. Defer until launch prep.

### 38. Env var validation
`NEXT_PUBLIC_API_URL` is read in `lib/env.ts` with no validation. Add a zod check + helpful error if missing.

---

## Priority order (suggested)

**This week:** #1 (403 fix via /onboarding), #2 (platform list from schemas), #4 (org-switcher dialog), #6 (profile switcher), #7 (profile picker on connect), #8 (profile scope on key create), #16 (webhook event multi-select).

**Next week:** #5 (/profiles CRUD), #9 (profile filter on log), #10–12 (post log filters), #20 (key scope badge), #26 (first-run checklist).

**When pain demands:** #17–19 (webhook test/log/rotate), #23–25 (account detail/Pinterest), #28 (dark mode), #34 (SWR migration), #37 (e2e).

**Skip until launch:** #36 (Storybook), most polish items.
