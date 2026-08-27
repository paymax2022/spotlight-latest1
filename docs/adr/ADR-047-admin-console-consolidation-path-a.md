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
- **Slice 4** (planned) — roll Path A out to the remaining three: openmic,
  registration, scoring, reality-show.
- **Slice 5** (planned) — fix the store-vs-persistence import mismatch caught
  while spiking slice 3 (below), then delete `frontend-web/app/admin`.

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

### Known issue surfaced, not fixed, by the slice 3 spike

The frontend-admin dashboard root imports `openmic/store` (in-memory) where the
other consoles import `openmic/persistence` (Supabase-backed), and
`contests/[slug]/applicants` imports both stores side by side. This is a real
data-correctness bug — reads and writes can land in memory and vanish — not a
Path A design question, so it's scoped to slice 5 rather than folded into slice
3 or 4.

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
- `frontend-web/app/admin` cannot be deleted until slice 4 finishes; until then
  slice 1's guard is the only thing preventing re-divergence, and it costs every
  PR that happens to touch either directory a CI check.

### Risks
- A future module could be added to frontend-web's TypeScript layer with admin
  needs and nobody remembers Path A exists, reinventing a third pattern.
  Mitigated by this ADR plus the two-proxy naming (`web-proxy` vs
  `admin-proxy`) making the split visible at the call site.
- The slice-5 store/persistence mismatch is a live data bug sitting in
  production admin surfaces until it's fixed; Path A's contests pilot did not
  touch openmic, so it neither caused nor fixed it, but it's now formally
  scheduled rather than only noted in a commit body.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Finish the original direction (frontend-web absorbs frontend-admin) | Re-does 71 working modules' worth of frontend-admin's existing Go integration to reach the same end state; the stalled attempt already left 441 duplicated pages doing this |
| Build a Go module per orphaned console (openmic, registration, scoring, reality-show) before moving any page | Blocks all four consoles on backend work sized for none of them individually; Path A ships the pilot (contests) same-day |
| Extend `/api/admin-proxy` with a path-matching table for both upstreams | One mis-sorted rule away from forwarding `ADMIN_API_KEY` to frontend-web; a secret-free dedicated proxy removes the failure mode structurally |
| Give `WEB_API_BASE_URL` a same-port fallback like `ADMIN_API_BASE_URL` has | The existing fallback on `ADMIN_API_BASE_URL` is the exact failure mode already burned once (404s misread as missing routes); an explicit 500 was chosen deliberately |

## Related

- Commits: `07125457` (slice 1, CI drift guard), `f0af9361` (slice 3, Path A spike)
- `.github/workflows/admin-drift-guard.yml`, `scripts/ci/check-admin-surface-drift.sh`
- `frontend-admin/app/api/web-proxy/[...path]`, `frontend-admin/app/admin/contests`
- Superseded direction: `ADMIN_CONSOLIDATION_SUMMARY.md` (root) — describes the
  original frontend-web-absorbs-frontend-admin plan; kept for history, no longer
  the plan. Should be marked superseded or removed once slice 5 lands.
- Linked ADRs: none yet (`ADR-025-backend-module-consolidation.md` is a different
  consolidation — backend modules, not admin consoles — no dependency)
