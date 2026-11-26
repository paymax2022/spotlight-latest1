# ADR-047 — Admin console consolidation: frontend-admin survives, Path A for orphaned data

**Date:** 2026-08-27
**Status:** Accepted
**Deciders:** Admin platform (t)

## Context

Spotlight has run two admin consoles side by side: `frontend-admin` on port 3001
(71 modules, the Go-backed admin API at 8091, its own auth UI) and
`frontend-web/app/admin` on port 3000 (a partial admin surface bolted onto the
main consumer app during an earlier consolidation attempt, `feat/admin-portal-
consolidation`, merged in `faeda28b`). That earlier attempt moved outward — copy
frontend-admin's modules into frontend-web and retire 3001. It stalled after the
copy: 441 of frontend-web's admin pages are byte-identical copies of
frontend-admin's, and because both surfaces kept receiving work after the stall,
9 pages diverged. Two admin consoles is not a stable end state; carrying both
forward indefinitely was never the plan, only what happened when the first
attempt didn't finish.

This ADR reverses the direction: **frontend-admin (3001) is the survivor**,
`frontend-web/app/admin` is retired. Two things made this the practical choice
rather than finishing the original direction:

1. frontend-admin already has 71 working modules, a unified Go backend
   (`ADMIN_API_BASE_URL`, proxied same-origin via `/api/admin-proxy`), and its own
   auth UI. Reversing means deleting an unfinished, partially-diverged copy;
   finishing the original direction means re-doing the work frontend-admin
   already has.
2. A handful of frontend-web admin pages are not copies — they are SERVER
   components reading frontend-web's own TypeScript layer directly (`@/src/
   server/*`) with no Go module behind them: openmic, registration, scoring,
   reality-show. Those have no equivalent in frontend-admin and cannot be
   deleted; their data has to keep being reachable from wherever the survivor is.

## Decision

**frontend-admin is the one admin console.** `frontend-web/app/admin` is deleted
once every page it uniquely serves has a home in frontend-admin. The migration
runs in slices, each shipped independently:

- **Slice 1** (`07125457`) — a CI guard (`admin-drift-guard.yml`) so the retiring
  surface cannot silently diverge again while later slices are in flight. Rule:
  any change that touches `frontend-web/app/admin/**` must also touch
  `frontend-admin/app/admin/**`, unless the change is a pure deletion from the
  retiring surface. Deliberately not symmetric — normal frontend-admin-only work
  must not be nagged at.
- **Slice 3** (`f0af9361`) — the data-path spike: how does frontend-admin reach
  the four TypeScript-layer modules that have no Go backend? Contests was the
  pilot. **Path A**, below, is the answer this slice validated.
- **Slice 4** (`bf44098a` Open Mic, `c7e504d0` Judges & Scores, plus the
  Stages & Evictions console below) — Path A rolled out to three of the four
  remaining orphaned modules. Registration's console shipped as part of slice 5
  (below) rather than separately, since fixing its data path and giving it a
  console were the same PR.
- **Slice 5** (`397b2835`) — fixed the store-vs-persistence import mismatch
  caught while spiking slice 3: the admin dashboard, reports, bulk-action
  review and the registration/applicants routes all read (and bulk-action
  wrote) `registration/store`, the in-memory version nothing real ever writes
  to, instead of `registration/supabase-store`. Shipped frontend-admin's
  Registration / Applicants console in the same commit. **Deleting
  `frontend-web/app/admin` did not happen in this slice** — see "Remaining
  work" below; that was this ADR's original plan for slice 5 but turned out to
  need its own slice once the scope of "fix the mismatch" became clear.
- **Reality-show / Stages & Evictions** — the fourth orphaned module got its
  data-path fix (`c7aa80e3`: `reality-show/persistence.ts` replaces the
  `globalThis` store the admin API routes read from) and its frontend-admin
  console (`realityShowAdminService.ts` + `app/admin/stages-evictions/*`) in
  two separate passes, the console following after the fact rather than in the
  same commit as slices 4/5 — worth knowing if a future audit expects one
  commit per module the way Open Mic and Judges & Scores got.

### Remaining work (as of 2026-08-28)

The auto-detection this ADR relied on (grep frontend-web/app/admin for
`@/src/server` imports to find modules with no Go backend) missed two:
**sme-pitch** and **payments-finance** — both read frontend-web's TypeScript
layer directly but happened to sit outside the four this ADR originally
named. Caught only by auditing every file under `frontend-web/app/admin`
before deleting it, rather than trusting the original four-module count.
Both now have a real data path and a frontend-admin console, same as the
original four (contests, open-mic, scoring, registration) plus reality-show
— six orphaned modules total, all covered.

**`frontend-web/app/admin` has been deleted** (both `(dashboard)`, 11 route
groups, and `(modules)`, 74 directories from the original
`feat/admin-portal-consolidation` attempt) — the point of this ADR, done.
Deleted alongside it: slice 1's CI guard (`admin-drift-guard.yml` +
`scripts/ci/check-admin-surface-drift.sh`, PR-triggered, dead weight once
there was nothing left to protect) and the two now-meaningless
`app/admin/(modules)` / `app/admin/[...slug]` exclusions in
`frontend-web/tsconfig.json` (that file's own comment already said to
remove them "as the consolidation cleanup lands").

What's still open, unrelated to the deletion itself:
- Open Mic's documented scope cut stands: fraud-alert resolution, marking
  notifications sent, payment reconciliation, finalist generation, winner
  announcement, and building/locking the finale playlist have no admin UI
  wired to their (already Path-A-ready) API routes yet.
- A mismatch surfaced while building the Stages & Evictions console:
  `reality_show_contestants.application_id` has a foreign key to
  `public.contest_registration_applications`, a different and currently empty
  table from `public.registrations` — the one the live registration flow (and
  the Registration / Applicants console) actually writes to. Same class of
  bug slice 5 fixed for registration itself, not yet triaged for reality-show.
- The route-guard gap found while wiring payments-finance for a real
  `finance_admin` account — `frontend-admin/src/features/auth/routeGuard.ts`
  default-denies any unlisted `/admin/*` route — is fixed for all six Path A
  consoles (separate commit), but the same audit hasn't been run against
  frontend-admin's other, Go-backed consoles; a non-wildcard role could still
  be silently locked out of any of those the same way.

### Path A: expose orphaned data as an authenticated API, proxy it, don't rebuild it in Go

For a module whose data lives only in frontend-web's TypeScript layer:

```
frontend-web   /api/v1/admin/<module>     authenticated + admin-role checked
frontend-admin /api/web-proxy/[...path]   forwards to frontend-web, same shape as /api/admin-proxy
frontend-admin /admin/<module>            client component, same shape as its Go-backed peers
```

This was chosen over the alternative of inventing a Go module per orphaned
console before a single page could move — three backend modules built speculatively,
for four consoles, before any of them shipped.

**Auth needed no bridge**, which was the open risk this spike existed to close.
Both consoles were assumed to use different auth systems; they do not.
frontend-admin signs in via `supabase.auth.signInWithPassword` and holds
`session.access_token`; frontend-web's `requireRequestUser` validates exactly
that token via `supabase.auth.getUser`. Both are Supabase — what differs is the
sign-in UI and where the token is held, not the identity provider. The role
check on the frontend-web endpoint is explicit and separate from that, because
`requireRequestUser` answers "who are you", not "may you" — the same gap that
left `/api/crowdfunding/admin` authenticated-but-unauthorized until `e7945b3d`.

**A second proxy, not a branch in `/api/admin-proxy`.** That existing proxy
targets the Go backend and attaches `ADMIN_API_KEY` to every request. A single
proxy with a path-matching table deciding both upstream *and* secret is one
mis-sorted routing rule away from sending the admin key to frontend-web. The web
proxy (`/api/web-proxy`) reads no secret at all — it forwards only `Authorization`
and `Content-Type`.

**`WEB_API_BASE_URL` has no fallback.** `ADMIN_API_BASE_URL` defaults to `:8080`
(a Docker container, not the Go backend) and that default has already produced
404s that read as missing routes for far longer than they should have. Unset,
`/api/web-proxy` returns an explicit 500 naming the missing variable instead of
silently targeting a plausible wrong port.

Verified hop by hop for the contests pilot (the authenticated round-trip
excepted — that needs a real admin sign-in):

| Call | Result |
|---|---|
| `:3000/api/v1/admin/contests` | 401 `{"success":false,"error":"Unauthorized"}` |
| `:3001/api/web-proxy/…/admin/contests` | 401, same body — proves the request reached the web app, not Go, whose error shape differs |
| `:3001/api/web-proxy/…/not-a-route` | 404 — so the 401 above is real routing, not the proxy eating the path |
| `:3001/admin/contests` | 200, real data (4 contests) |

`tsc` clean in both apps.

### Multipart uploads through this proxy

Three Path A consoles post bytes rather than JSON through this proxy — contest
banners/logos (`contestsAdminService.ts`), Open Mic beats (`openMicAdminService.ts`),
and the contest-template frames (`/admin/voting/templates`). The last one is why
`app/api/web-proxy/[...path]/route.ts` now carries two deadlines.
`WEB_PROXY_TIMEOUT_MS` (20 s) stays right for the JSON relays; a
body over `LARGE_UPLOAD_BYTES` (4 MiB) gets `WEB_PROXY_UPLOAD_TIMEOUT_MS` (180 s). One
deadline for both was the bug: the short one aborted mid-transfer, the console reported
"the web app did not answer", and frontend-web had already stored the image — so the
admin's retry stacked a second copy in the bucket.

This proxy applies **no** body cap, unlike frontend-web. Next forks the request body only
where a middleware/proxy layer runs, and `middleware.ts` matches `['/admin/:path*']`, so
`/api/web-proxy` runs no proxy layer and never forks it. Measured rather than assumed: a
20 MiB multipart relayed with `declared == received == 20 971 726` and no buffering
warning. If that matcher ever grows to cover `/api/*`, this route needs the same
`experimental.proxyClientMaxBodySize` treatment `frontend-web/upload-limits.config.mjs`
exists for, or every large upload starts arriving cut in half.

Every refusal on the route names its cause, because the console renders `error` verbatim
and one blanket sentence — "Failed to upload template image" — hid several unrelated
faults at once, including the incident that started the hunt: a stopped
`supabase_storage_spotlight` container made `supabase.storage.upload()` answer 502 while
every other Supabase call kept working. The mapping lives in
`frontend-web/src/lib/storage/storage-error.ts`:

| Code | Status | Means |
|---|---|---|
| `file_too_large`, `storage_too_large`, `upload_incomplete` | 413 | over the 50 MiB cap, or a body cut off in transit |
| `file_type_unsupported`, `storage_type_rejected` | 400 | mime outside the bucket's `allowed_mime_types` |
| `contest_id_invalid`, `template_contest_not_found` | 400 | the selector's contest UUID is malformed or gone |
| `name_required`, `contest_required`, `file_required` | 400 | a form field the console did not send |
| `template_actor_has_no_profile`, `template_insert_bad_id` | 400 | no `user_profiles` row for this admin, or a non-UUID id |
| `storage_duplicate` | 409 | an object with that name already exists |
| `multipart_required` | 415 | the request was not multipart at all |
| `storage_bucket_missing`, `storage_policy_refused`, `storage_upload_failed`, `template_insert_refused`, `template_insert_failed` | 500 | bucket/policy/record fault, not the admin's file |
| `storage_unreachable` | 502 | storage is down — the original incident, now distinguishable |

The trap the classifier exists for: Supabase reports `status: 400` for an oversize file
*and* for a refused mime type, so reading `status` alone turned every "your file is too
big" into an undifferentiated server error. The stable signals are `statusCode` plus
`code`. The 50 MiB / mime list are pinned to
`supabase/migrations/20260405700000_contest_image_templates.sql` on both sides by
`frontend-web/tests/unit/voting/contest-template-bucket-policy.spec.ts` and
`frontend-admin/tests/admin/contest-template-upload-gate.spec.ts`, so a migration edit
fails CI instead of quietly desynchronising the console from the bucket.

A refused create leaves nothing behind: if the insert fails after the object is written,
`app/api/admin/voting/contest-templates/route.ts` removes the object, and the
`x-admin-key` path stores `created_by = null` instead of the literal `'api-key'` in a
UUID column — the `22P02` that used to fail that insert *after* a successful upload.

**Do not read routing off a duplicate dev server.** Next 16 lets one `next dev` own a
project directory (`<app>/.next/dev/lock`); a second launch exits with "Another next dev
server is already running." An instance that ends up competing like this answers its two
catch-all proxies as if they did not exist — 404 on `GET /api/web-proxy/…`, and 409
`Server Action unavailable.` (text from Next's own app-render action handler, not this
app) on a multipart `POST` — while a static route such as `/api/contests` still answers
200. Observed 2026-11-26 with `frontend-admin` in a task worktree: the table above only
reproduces against a single clean instance, which answers 401 from inside `forward()` for
both catch-alls. Suspect the instance before believing a catch-all is broken.

### Known issue surfaced by the slice 3 spike — status after slice 5

The original finding: `frontend-web/app/admin/(dashboard)/page.tsx` (the
retiring surface's OWN dashboard root, not frontend-admin's — frontend-admin
has no server-side access to frontend-web's TypeScript modules, they're
separate Next.js apps) imports `openmic/store` (in-memory) where every other
open-mic page under `(dashboard)/open-mic/**` imports `openmic/persistence`
(Supabase-backed). `contests/[slug]/applicants` similarly imports both
`registration/store` and `registration/supabase-store` side by side — though
that one turned out to be intentional: `registration/store` there supplies
only the static contest catalog (name/slug metadata), not applicant data, and
contest definitions are meant to stay in-memory config rather than a live
table (`registration/supabase-store.ts` re-exports them from `store.ts` for
exactly this reason).

**registration/applications/dashboard/reports's live-data mismatch is fixed**
(slice 5, `397b2835`) — those routes now read `registration/supabase-store`.
**The `openmic/store` import in `frontend-web/app/admin/(dashboard)/page.tsx`
is NOT fixed** — it's still there, still wrong, but that whole file is deleted
once `frontend-web/app/admin` goes (see "Remaining work" above), so it was
left alone rather than patched in a file with a known expiry date.

## Consequences

### Positive
- One admin console going forward; no more silent divergence once slice 1's
  guard is in place.
- Path A ships orphaned-data consoles without inventing Go modules for data that
  may itself move to Go later — the proxy is a bridge, not a permanent second
  backend integration to maintain in frontend-admin.
- The auth-bridge risk, the actual unknown going into slice 3, is retired: no
  token translation layer needed between the two consoles.

### Negative / trade-offs
- Two proxies now live in frontend-admin (`/api/admin-proxy` for Go,
  `/api/web-proxy` for frontend-web). Anyone adding a route must know which
  upstream their module's data actually lives on.
- Path A consoles depend on frontend-web staying up and reachable from
  frontend-admin's server runtime even after `frontend-web/app/admin` itself is
  deleted — the TypeScript data layer survives in frontend-web even though its
  admin UI does not.
- `frontend-web/app/admin` is deleted (see "Remaining work" above), along
  with slice 1's guard — nothing left for it to protect.

### Risks
- A future module could be added to frontend-web's TypeScript layer with admin
  needs and nobody remembers Path A exists, reinventing a third pattern.
  Mitigated by this ADR plus the two-proxy naming (`web-proxy` vs
  `admin-proxy`) making the split visible at the call site.
- The slice-5 store/persistence mismatch for registration/dashboard/reports is
  fixed (`397b2835`). The same class of mismatch is still open for reality-show
  (`reality_show_contestants.application_id` → `contest_registration_applications`,
  an empty table, instead of `registrations`) — see "Remaining work" above.
  Path A's contests pilot did not touch either module, so it neither caused nor
  fixes these; each has needed its own dedicated pass.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Finish the original direction (frontend-web absorbs frontend-admin) | Re-does 71 working modules' worth of frontend-admin's existing Go integration to reach the same end state; the stalled attempt already left 441 duplicated pages doing this |
| Build a Go module per orphaned console (openmic, registration, scoring, reality-show) before moving any page | Blocks all four consoles on backend work sized for none of them individually; Path A ships the pilot (contests) same-day |
| Extend `/api/admin-proxy` with a path-matching table for both upstreams | One mis-sorted rule away from forwarding `ADMIN_API_KEY` to frontend-web; a secret-free dedicated proxy removes the failure mode structurally |
| Give `WEB_API_BASE_URL` a same-port fallback like `ADMIN_API_BASE_URL` has | The existing fallback on `ADMIN_API_BASE_URL` is the exact failure mode already burned once (404s misread as missing routes); an explicit 500 was chosen deliberately |

## Related

- Commits: `07125457` (slice 1, CI drift guard), `f0af9361` (slice 3, Path A
  spike), `4918b6d6` (shared Path A scaffolding for slices 4/4a/5), `c7aa80e3`
  (reality-show data-path fix), `397b2835` (slice 5, registration/dashboard/
  reports fix + console), `bf44098a` (slice 4, Open Mic console), `c7e504d0`
  (slice 4a, Judges & Scores console + moved off its own `globalThis` mock onto
  `public.judge_application_scorecards`), `8166252ca` (template uploads relayed through
  this proxy: each refusal classified, a failed insert rolls its object back, bodies
  over 4 MiB get their own deadline). The Stages & Evictions console
  (`realityShowAdminService.ts`, `app/admin/stages-evictions/*`) followed in a
  separate pass after these; check `git log` for its commit if citing it later.
- `.github/workflows/admin-drift-guard.yml`, `scripts/ci/check-admin-surface-drift.sh`
  — deleted alongside `frontend-web/app/admin`; linked here for history.
- `frontend-admin/app/api/web-proxy/[...path]`, `frontend-admin/app/admin/contests`,
  `frontend-admin/app/admin/judges-scores`, `frontend-admin/app/admin/open-mic`,
  `frontend-admin/app/admin/registration`, `frontend-admin/app/admin/stages-evictions`,
  `frontend-admin/app/admin/sme-pitch`, `frontend-admin/app/admin/payments-finance`
- Superseded direction: `ADMIN_CONSOLIDATION_SUMMARY.md` (root) — describes the
  original frontend-web-absorbs-frontend-admin plan; kept for history, no longer
  the plan. Still not marked superseded/removed — see "Remaining work" above;
  low priority since it already carries a banner pointing here.
- Linked ADRs: none yet (`ADR-025-backend-module-consolidation.md` is a different
  consolidation — backend modules, not admin consoles — no dependency)
