# ADR-PR565 — Admin dashboard lists every approval queue, guarded against silent zeros and dead links

**Date:** 2026-10-08
**Status:** Accepted
**Deciders:** Platform / Admin console
**Scope:** `backend/internal/handlers/admin_overview.go` (registry + wire format), `admin_overview_test.go`, `frontend-admin/src/features/dashboard/AdminDashboard.tsx`, `frontend-admin/src/types/adminOverview.ts`. No migration, no new endpoint.

## Context

The admin dashboard shows only what `GET /api/v1/admin/overview` returns, and that is a hand-written registry
(`overviewSpecs`) of `count(*)` queries plus links. Pending business verifications never appeared because the
registry had no row for them; it had 16 rows against ~35 real approval queues.

Auditing it showed the registry fails **silently** in two ways, both invisible in review:

1. **A status string no row can hold counts 0 forever.** Restaurant withdrawals counted `status='pending'`; the
   only `INSERT` writes `'processing'`, so the queue read "all clear" while 64 cash-outs waited. Every module
   spells its pending state differently (`PENDING_REVIEW`, `queued`, `submitted`, `FNOL_SUBMITTED`, …).
2. **A link to a route with no `page.tsx` lands on the legacy catch-all.** 7 of the 16 attention links did.

A third problem is semantic: "not finished" is wider than "waiting on an admin". `draft` is not submitted and
`needs_more_info` / `CHANGES_REQUESTED` wait on the user, so counting them shows work nobody can do.

## Decision

1. **A queue belongs on the dashboard only if an admin must decide it.** Predicates name exactly the
   admin-actionable statuses, taken from the column's own CHECK/enum, not from a generic `status='pending'`.
2. **Every queue links to the page that resolves it, or says it has none.** `attention.href` is a real admin page.
   Where no working screen exists (today: health provider applications) `href` is empty and
   `attention.note` states why; the dashboard renders the count and the note, never a link to a dead end.
   Showing the count is preferred to hiding real work.
3. **Registry rows use named fields.** Positional literals compile when two SQL strings are swapped.
4. **Tests enforce 1 and 2** rather than review:
   - offline: structure, exactly one of `AttnHref`/`AttnNote`, every link resolves to an existing
     `frontend-admin/app/**/page.tsx` (skipped if the admin app is absent from the checkout);
   - live DB (`TEST_DATABASE_URL` only): every count query executes, and every `col = 'x'` / `col IN (...)` literal
     is accepted by that column's CHECK or enum. A missing table **fails** (CI replays every migration);
     `OVERVIEW_GUARD_ALLOW_MISSING=1` downgrades it for a developer database that lags.
5. **Unknown is still not zero.** A failing count renders `—` (unchanged).

## Consequences

- Adding a queue is one row, and a wrong status string or dead link fails CI instead of shipping a false all-clear.
- Columns with no CHECK/enum (STEM tables, `events.state` on some databases) cannot be verified by the guard; the
  test logs them as unverifiable and their rows normalise case, because the Go writers compare case-insensitively.
- The overview now issues ~90 count queries per load (was 32). Concurrency stays bounded (8) with a 4s per-query
  timeout on the shared pool; if it matters, cache the response briefly rather than dropping queues.
- Queues whose own page cannot act are deliberately **left off** until the page works (referral review queue, whose page
  filters `held` while the DB stores `queued`), so the dashboard never advertises work the linked page cannot show.
- Replacing an `AttnNote` with an `AttnHref` when a screen ships is a one-line change that the link test then validates.

## Alternatives considered

- **Generic `WHERE status IN ('pending', …)` template**: reports zero for most modules; the exact failure above.
- **Hide queues with no screen**: removes the signal that work exists, which is worse than a plain note.
- **Link to the module home page**: lands on a page that does not show the queue; the dashboard's principle is to end at the work.
