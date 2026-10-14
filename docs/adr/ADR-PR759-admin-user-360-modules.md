# ADR-PR759: User 360 profile, PR B - module memberships

Status: accepted · Follows ADR-PR754. Spec and plan: `docs/superpowers/` (branch `docs/admin-user-360-spec`).

## Context
An admin looking at one user cannot see which modules that user has onboarded into (restaurant owner,
marketplace seller, driver, doctor, ...). About 15 of the 22 modules have no admin endpoint keyed by
user id, and each of the others has its own permission model.

## Decisions
1. **One registry endpoint, `GET /api/admin/users/:id/modules`**, instead of 22 per-module endpoints or
   22 frontend fetches. Each module is one spec (`membershipSpec`: key, label, group, href, SQL) of the
   form `count(*), min(<created column>)::text ... WHERE <owner column> = $1`. Adding a module is one row.
2. **Gate: `users.view` plus the existing per-user scope check, and nothing finer.** The page already
   shows `users.view` holders KYC status, wallet balance, the full ledger, sessions and audit history
   (ADR-PR754), and this endpoint returns only existence, a count and the earliest date, no module
   data. Membership does let an admin infer sensitive facts (doctor, insurance policyholder, crypto
   account, savings or ajo member). If product wants finer control, `membershipSpec` can grow a
   per-row `Permission` field; that is additive and not built now.
3. **Soft-fail per row, and `error` is never folded into `none`.** A query that errors or times out
   (4 s) gives status `error` for that row; the request still returns 200. The panel therefore never
   claims "not onboarded" when membership is unknown ("No confirmed memberships" is shown instead).
4. **Feature flag `FEATURE_ADMIN_USER_MODULES_ENABLED`, default off; 404 when off.** The route is
   registered after the shared pgx pool exists and is a no-op without a pool.
5. **Process-wide concurrency cap.** The cap (`overviewConcurrency`, 8) is a package-level semaphore
   shared by all requests, not per request, and a waiting goroutine gives up when the request is
   cancelled. A per-request cap would let N concurrent page views run 8N queries on the pool that
   the money path also uses.
6. **Column choices were verified against the migrations, not assumed.** `events` counts
   `organiser_id` (canonical; `organizer_id` is legacy); `ajo_members` uses `joined_at` (it has no
   `created_at`); `user_module_grants` counts only rows not revoked and not expired. All owner columns
   are `uuid`, so the bound parameter matches.
7. **Two guards stand behind the SQL**, because a wrong column is otherwise silent: a structure test
   (shape, unique keys, links resolve to real admin pages) and `TestMembershipSpecs_ColumnsExist_LiveDB`,
   which runs every query against the migrated schema in the CI live-DB lane. This is the guard that
   PR A's photo query lacked (it selected a column that does not exist; see ADR-PR754).
8. **The user id is normalised** (`uuid.Parse(...).String()`) before it reaches the href or the bound
   parameter, so non-canonical forms (braces, `urn:uuid:`) never leak into either.

## Consequences
- **Before enabling the flag anywhere**, set `DB_POOL_MAX_CONNS` to at least 16. One profile view runs
  up to 22 queries (plus six REST reads for auth and the user lookup); on a small container the default
  pool is `max(4, NumCPU)`.
- `insurance_policy.policyholder_user_id` has no index, so that row scans the table on every profile
  view. It stays within the 4 s timeout today and degrades to `error` rather than failing the page.
  A follow-up additive migration should add the index.
- `since` is a Postgres text timestamp (`2026-01-02 03:04:05.123456+00`), not RFC 3339. Chrome renders
  it; Safari's parser rejects that form and shows the raw string. Follow-up: scan into `time.Time`.
- `events` and `event_tickets` both link to `/admin/events/approval` (two identical "Open" links).

## Not covered
Per-module activity (orders, rides, votes), a per-row permission, and enabling the flag on staging
(a Railway variable change that needs the owner's go-ahead).
