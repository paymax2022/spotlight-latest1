# Navigation Telemetry — Foundation design

**Date:** 2026-10-14
**Status:** Design (pre-implementation)
**Branch:** `feat/nav-telemetry-foundation`

## Purpose

Capture a privacy-preserving log of which **screens/pages** each end user visits in
the **mobile user app** and the **web user app**, so that:

1. **Admin support / forensics** — an admin can see a per-user recent navigation
   timeline on the user-profile page (what the user did before an issue).
2. **Product analytics** — aggregate which screens are used / where users drop off.

This spec is the **Foundation** only: the event contract, storage, ingest endpoint,
and retention. It is the piece every other sub-project builds on.

**Privacy posture (decided):** store **only** route name + timestamp + user id +
surface. No field values, no query strings, no PII in the route. Bounded retention
(90 days), auto-purged. Data stays in-house (no third-party analytics provider).

## Scope

This is sub-project 1 of a decomposed program:

- **SP1 — Foundation (THIS spec):** event contract + `navigation_events` table +
  ingest endpoint + retention purge + feature flag.
- **SP2 — Mobile instrumentation (later):** emit a screen-view event on each
  `expo-router` navigation in `mobile-app/reactnative`.
- **SP3 — Web instrumentation (later):** emit a page-view event on each Next.js
  route change in `frontend-web`.
- **SP4 — Admin surface (later):** a per-user read endpoint + a "navigation history"
  panel on `/admin/users/[id]`.
- **SP5 — Aggregate dashboards (later):** product-analytics views over the same
  table.

**Explicitly out of scope for SP1:** any client code, the admin read/panel, and
aggregate dashboards. The schema is designed so SP4 (per-user timeline) and SP5
(aggregates) both read this one table without change.

## Chosen approach (Approach A)

In-house lean ingest + a single events table + a periodic purge. Rejected
alternatives: an external analytics provider (sends behavior data off-platform,
conflicts with the in-house/privacy posture, none integrated) and piggybacking on
`audit_logs` (that table is for admin/security actions; screen-view volume would
pollute its semantics and retention).

## Data model

One additive migration adds `public.navigation_events`:

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` generated identity (or uuid) | PK |
| `user_id` | `uuid` NOT NULL | the authenticated user; **no FK** to `auth.users`/`platform_users` (project convention — avoids the FK-cleanup gotcha) |
| `surface` | `text` NOT NULL | `CHECK (surface IN ('mobile','web'))` |
| `route` | `text` NOT NULL | route name/pattern, bounded length (`CHECK (char_length(route) <= 256)`) |
| `occurred_at` | `timestamptz` NOT NULL | client event time |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | server receipt |

Indexes:
- `(user_id, occurred_at DESC)` — per-user timeline (SP4).
- `(route, occurred_at)` — aggregates (SP5).
- `(occurred_at)` — retention purge scan.

Access: **service-role only** — the backend reads/writes via the pgx pool with
service credentials. No client-facing RLS read path (clients only POST through the
authenticated ingest endpoint). Follow the project's RLS conventions for a
service-only table; do not FORCE RLS without a write policy.

Migration is **additive-only** and its version stamp is **re-checked immediately
before merge** (per the repo's cross-PR stamp-collision rule).

## Ingest endpoint

`POST /api/v1/telemetry/navigation` — mounted on the authenticated user group
(`middleware.RequireAuthContext`), gated by the feature flag.

Request body (a batch):

```json
{ "events": [ { "surface": "mobile", "route": "crypto/assets", "occurred_at": "2026-10-14T10:00:00Z" } ] }
```

Rules:
- `user_id` is taken **from the authenticated token**, never from the body. A
  body-supplied user id is ignored.
- `events` capped at **50** per request; an over-cap request is rejected `400`.
- Each event validated:
  - `surface` ∈ {`mobile`,`web`} else the event is rejected.
  - `route` is non-empty, ≤ 256 chars, and **must not contain a query string or a
    value-like segment** — reject (or drop) any route containing `?`, `=`, `&`, or a
    path segment that is a uuid/number/email (so ids, amounts, emails never land in
    the store). Document the exact rejection rule in the handler.
  - `occurred_at` parses as RFC3339 and is within a sane window (not more than, say,
    24h in the future or 90d in the past) else the event is dropped.
- Per-user **rate limit** via the existing Redis (`backend/internal/platform/redis`)
  — a token-bucket keyed by user id; over-limit returns `429`.
- Response `202` with `{ "accepted": <int> }` (count of events stored after
  validation). Partial batches are fine: invalid events are dropped, valid ones
  stored, and `accepted` reflects the stored count.
- Append-only; **no idempotency key** for v1 (duplicate events are tolerable and
  cheap; de-duping is a later optimization if volume demands it).

## Retention

A daily **asynq** periodic task (`telemetry:purge-navigation`, registered with the
existing queue server in `backend/internal/platform/queue`) deletes rows older than
**90 days**:

```sql
DELETE FROM navigation_events WHERE occurred_at < now() - interval '90 days'
```

Delete in **bounded batches** (e.g. `... LIMIT 10000` in a loop, or by id range) to
avoid a long table lock. The retention window (90d) is a named constant. The purge
is gated by the same feature flag.

## Feature flag

`FEATURE_NAV_TELEMETRY` (Go `config.go`) gates the ingest route registration and the
purge task. **OFF by default** — the endpoint 404s / the purge no-ops until the flag
is on, which happens only once the clients (SP2/SP3) are ready to emit. New module ⇒
a flag is required (CLAUDE.md). The matching client env flag is introduced in SP2/SP3.

**Consent/legal:** whether end-user consent is required to record navigation is a
product/legal decision, flagged here as an open item — not a code blocker. The
privacy-preserving defaults (route-only, bounded retention, in-house) are chosen to
minimize that burden.

## Testing

**Backend (`go test`):**
- Ingest handler: `user_id` is taken from the token and a body-supplied id is
  ignored; a batch over the 50 cap is `400`; `surface` outside the set is dropped; a
  `route` with a query string / value-like segment is rejected (assert the exact
  cases: `pay?amount=500`, `users/<uuid>`, `profile/foo@bar.com`); a far-future /
  far-past `occurred_at` is dropped; a valid batch returns `202` with the right
  `accepted` count and the rows land with the token's user id.
- Rate limit: over-limit returns `429` (may be a focused unit test around the limiter).
- Purge task: seeds rows older and newer than 90d, runs the purge, asserts only the
  old rows are deleted (live-DB-gated on `TEST_DATABASE_URL`, with `t.Cleanup`).

## Open items for the implementation plan

- Exact route-validation regex/ruleset (the specific "value-like segment" detection).
- Rate-limit bucket size/refill (pick sane defaults for ~screen-view cadence).
- Whether `id` is bigint-identity or uuid (match the repo's prevailing convention for
  high-volume append tables).
- asynq periodic-task registration pattern (confirm against the existing queue setup).
