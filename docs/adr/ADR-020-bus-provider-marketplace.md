# ADR-020 — Interstate Bus Provider Marketplace

**Date:** 2026-07-04  
**Status:** Accepted  
**Deciders:** Platform team

## Context

The bus vertical shipped as an **admin-driven catalog**: routes and schedules
were free-text rows an admin curated, customers searched by origin/dest strings
and booked a seat (`/mobility/bus/routes`, `/mobility/bus/schedules`,
`/mobility/bus/book`). There was no notion of a bus *operator* as a first-class,
self-service tenant — every route had to be entered centrally, and there was no
per-operator identity, verification, rating, or settlement target.

Nigerian interstate bus travel is inherently operator-centric (GIGM, ABC,
Chisco, God is Good, etc.) and **state → state** rather than point-to-point.
Customers pick an operator and a state pair (Lagos → Abuja), then a departure.
The old free-text `origin`/`dest` model couldn't express "verified operator",
"routes owned by an operator", or "settle this booking to that operator".

The booking money-path already existed and works: `BookBusTicket` escrows the
fare and settles the operator on boarding (kobo, `Idempotency-Key`, tier gate,
double-entry ledger, audit event). What was missing was the *marketplace* layer
above it.

New backend files:
`backend/internal/transport/bus_provider.go` (provider/route/schedule service +
ownership gate), `backend/internal/transport/bus_handler.go` (HTTP handlers),
`backend/internal/transport/bus.go` (existing booking/search),
`backend/internal/transport/bus_provider_test.go`.
Migration: `supabase/migrations/20260907000000_bus_provider_marketplace.sql`
(additive-only — new `bus_providers` table, `ADD COLUMN IF NOT EXISTS` on
`bus_routes`, interstate CHECK, indexes, RLS).

## Decision

1. **Provider self-service marketplace over the old admin-only catalog.**
   Operators register themselves (`POST /mobility/bus/provider/register`),
   publish their own routes, and self-schedule departures. The admin-curated
   catalog is not removed — the legacy `/mobility/bus/routes` /
   `/mobility/bus/schedules` / `/mobility/bus/book` endpoints stay (additive
   safety), but new supply comes from providers. A `bus_providers` row is keyed
   `owner_user_id UNIQUE` — one provider per user; that column is the ownership
   gate for every `/mobility/bus/provider/*` route (a non-provider caller gets
   403).

2. **Interstate model with `from_state`/`to_state` + a same-state constraint
   enforced at three layers.** A route carries `from_state` and `to_state`, and
   `from_state == to_state` is rejected: at the UI (client validation), at the
   service (`400` on `POST /mobility/bus/provider/routes` and on
   `/mobility/bus/search` when `fromState` and `toState` are both present and
   equal), and at the database (`bus_routes_diff_states` CHECK). The DB CHECK is
   NULL-tolerant so pre-marketplace admin rows (NULL states) still pass —
   additive-only.

3. **Providers are active on register, with `verification_status = 'pending'`.**
   Registration is frictionless — a new provider can immediately publish routes
   and schedules and take bookings. Trust is surfaced by a **verified badge**
   (`verified = (verificationStatus == 'verified')` in every provider DTO), and
   `verification_status` is the enum `pending | verified | suspended`. **Admin
   verification is the go-live trust gate**: before go-live, search/discovery
   should prefer/require verified providers. Registering does not auto-verify.

4. **Each booking is a seat on a provider's scheduled departure, settled to the
   provider owner via the existing escrow/settle money path.** A booking is a
   seat on a `bus_schedules` row that belongs (through `bus_routes.provider_id`)
   to a provider. The booking reuses `BookBusTicket` unchanged: it escrows the
   fare and settles the **route's provider owner** — in kobo, requiring an
   `Idempotency-Key` header, passing the tier limit gate fail-closed, posting a
   balanced double-entry ledger, and emitting an audit event. No new money path
   was written; the marketplace only changes *who* the settlement target is.

5. **Specific posted departures rather than recurring templates.** A provider
   posts individual departures (`POST /mobility/bus/provider/routes/{id}/
   schedules`, one `departure_time` each) instead of defining a recurring
   timetable that materializes future runs. This keeps the schema and the
   booking/seat-inventory model simple (each departure is a concrete row with
   `total_seats`). Recurring/template scheduling is **future work**.

## Consequences

### Positive
- Operators are first-class tenants: own identity, routes, ratings,
  verification, and settlement target — the shape real interstate bus supply
  needs.
- Zero new money-path code: bookings settle through the proven escrow/settle
  ledger flow; the only change is the settlement counterparty.
- Fully additive migration — the legacy admin catalog and existing tickets keep
  working; no DROP/RENAME/narrowing, no regression risk to booked seats.
- The same-state invariant is defended in depth (UI, service `400`, DB CHECK),
  so bad data can't enter from any layer.

### Negative / trade-offs
- Self-service registration means unverified operators can list immediately;
  discovery must lean on the verified badge / verification gate to protect
  customers until admin verification exists at go-live.
- Posting individual departures is more manual for high-frequency operators than
  a recurring timetable would be.
- `fare_kobo` on a schedule carries a `fareApproved` flag but pricing approval
  workflow/enforcement is minimal pre-go-live (see Deferred).

### Deferred
- **Admin verification workflow + go-live enforcement** (verify/suspend
  providers; require `verified` for search visibility).
- **Recurring departure templates** that auto-materialize future schedules.
- **Fare approval enforcement** beyond the `fareApproved` marker.
- **Provider ratings write path** wiring (schema fields exist; aggregation from
  completed trips to be finalized).
- **RBAC permission surface** for provider actions (currently gated by
  `owner_user_id` ownership only).
