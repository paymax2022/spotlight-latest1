# ADR-017 — Multi-Pharmacy Discovery + Ratings

**Date:** 2026-07-03  
**Status:** Accepted  
**Deciders:** Platform team

## Context

The pharmacy vertical (migration `20260815000200_health_pharmacy.sql`,
`backend/internal/health/pharmacy`) already prices, holds payment for, and
fulfils an order against a single `pharmacy_provider_id` the client supplies —
but nothing in the backend let a customer discover *which* pharmacy to supply.
`GET /pharmacy/products` and `POST /pharmacy/orders` both assumed the caller
already knew the provider id.

Meanwhile the mobile app (`app/health/pharmacy/pharmacy-select.tsx`,
`src/features/health/pharmacy/api.ts`) already ships a full "choose a
pharmacy" UI — distance, star rating, review count, delivery ETA/fee, pickup
vs. delivery — entirely against `MOCK_PHARMACIES`. There was no `GET
/pharmacies` endpoint, no rating data anywhere in the health platform (vet and
lab have the same gap), and no `pharmacy_provider_profiles`/`pharmacy_reviews`
tables.

Constraints:

- Brownfield-safe: `pharmacy_products` / `pharmacy_orders` / `health_providers`
  must not be altered destructively; migrations are additive-only.
- `health_providers` already carries a PostGIS `geo geography(Point,4326)`
  column with a GIST index (migration `20260815000100_health_platform.sql`),
  and the **vet** vertical (`healthvet.DiscoverVets`) already queries it with
  `ST_Distance`/`ST_DWithin` for proximity discovery. Reuse, don't reinvent.
- No ratings/reviews subsystem exists anywhere in the health platform today;
  the "rating"/"reviewCount" fields in the mobile mocks are fabricated.
- HL-2: only APPROVED + discoverable providers may surface to customers.
- Money/kobo, idempotency, and audit rules (root `CLAUDE.md` NL-1..12) apply
  to anything that writes.

## Decision

1. **Reuse `health_providers.geo`, mirror `healthvet.DiscoverVets`.**
   `healthpharmacy.Service.DiscoverPharmacies(lat, lng, radiusM, sort)` runs the
   same `ST_Y/ST_X/ST_Distance/ST_DWithin` shape as the vet vertical, filtered
   to `domain='PHARMACY' AND provider_type='pharmacy' AND status='APPROVED' AND
   discoverable=true`. Default radius 25km, same as vet. No new geo storage,
   no new index — the existing `idx_health_providers_geo` GIST index serves
   both verticals.

2. **A separate `pharmacy_provider_profiles` table**, not new columns on the
   shared `health_providers` row. `health_providers` is shared across
   VET/PHARMACY/LAB; pharmacy-only concerns (address, pickup/delivery support,
   delivery fee, rating aggregate) would otherwise force nullable,
   domain-specific columns onto a table two other verticals also own. The
   profile row is optional — discovery/detail reads `LEFT JOIN` it and
   `COALESCE` every field to a safe default — so approval never depends on a
   profile existing, and a pharmacy with no reviews yet still discovers fine
   (`avg_rating=0, rating_count=0`).

3. **A new `pharmacy_reviews` table, gated to completed orders.**
   `SubmitReview` requires the caller to own the order and the order to be in
   `DELIVERED|COLLECTED|CLOSED` — a review reflects a fulfilled experience, not
   an in-flight one. `UNIQUE(order_id)` is the DB-level backstop: a
   retried/duplicate submit is rejected outright rather than silently
   double-counted into the aggregate. The free-text `body` is trimmed and capped
   at `maxReviewBodyLen` (2000 runes) server-side to bound storage/response size
   and blunt stored-content abuse. The reviewer's identity is never serialised to
   other readers (`PatientID` is `json:"-"`, HL-8), and — per the security review
   below — the `pharmacy_reviews` RLS SELECT policy grants read access to the
   **authoring patient and admins only**; the pharmacy owner reads their reviews
   through the Go service (which strips `patient_id`) and cannot de-anonymise a
   reviewer by querying the table directly via PostgREST.

4. **Rating aggregate is trigger-maintained, never client-set.** An `AFTER
   INSERT` trigger on `pharmacy_reviews` recomputes `avg_rating`/`rating_count`
   into `pharmacy_provider_profiles` (upserting the row if it doesn't exist
   yet) in the same transaction as the review write — no background job, no
   read-time aggregation query on the discovery hot path.

5. **Sort resolution never silently misleads the caller.** `resolveSort`
   requires both `lat` and `lng` before honoring `sort=distance`; without
   coordinates it falls back to `rating` rather than erroring or ignoring the
   request. An unrecognised `sort` value degrades the same way. This is a pure
   function (`model.go`), unit-tested independent of the DB.

6. **No new feature flag.** Discovery/profile/reviews ride under the existing
   `FEATURE_HEALTH_PHARMACY_ENABLED` — this is an extension of the pharmacy
   vertical, not a new module, and matches how `healthvet.DiscoverVets` isn't
   separately flagged from `FEATURE_HEALTH_VET_ENABLED`.

7. **Routes**: `GET /pharmacy/pharmacies` (discover), `GET
   /pharmacy/pharmacies/{id}` (detail), `GET /pharmacy/pharmacies/{id}/reviews`
   (public feed), `POST /pharmacy/pharmacies/{id}/profile` (verified owner
   only, HL-2), `POST /pharmacy/orders/{id}/reviews` (patient, completed order
   only). All under the existing member group
   `/api/finance/health/pharmacy/*`.

## Post-implementation review (2026-07-03)

Before merge, the subsystem passed a parallel **ledger/money-path audit** and
**security review** scoped to the discovery + ratings files.

- **Ledger / money-path: PASS.** The rating flow reads authoritative order state
  (`pharmacy_orders.state`, only reachable via the pharmacist-gated
  `Dispense`/`Dispatch` chain) to decide reviewability and performs exactly one
  write — the `pharmacy_reviews` INSERT. No wallet/ledger/escrow mutation, no
  float money (all amounts integer kobo; `avg_rating` is a 1–5 statistic, not
  money), and no review→payout/incentive path. The aggregate trigger touches
  only the two projection columns.
- **Security: no critical/high.** Aggregate is non-client-writable on every path;
  one-review-per-order is DB-constraint-enforced (race-safe, no TOCTOU);
  PostGIS/`ORDER BY` are injection-safe (allowlisted `sort`, parameterised geo);
  auth + feature-flag gating cover the whole vertical; migration is additive-only.

Two low-severity findings were **fixed in this pass**:

- **F1 — unbounded review body.** `body` was only trimmed, allowing a multi-MB
  payload (storage/response bloat) or stored content a client might render
  unescaped. Fixed: `normalizeReviewBody` caps at 2000 runes server-side
  (`model.go`), unit-tested in `discovery_test.go` (`TestNormalizeReviewBody`).
- **F2 — RLS de-anonymisation.** The original `pharmacy_reviews_party` SELECT
  policy also granted the pharmacy owner read access to full review rows
  (including `patient_id`), contradicting the HL-8 anonymity stated in decision 3
  — exploitable only via direct PostgREST, not the Go endpoints, but broader than
  intended. Fixed: the owner branch was removed from the policy (patient + admin
  only); owners still see reviews through the `patient_id`-stripping Go service.

One informational item (F3) is **accepted, not fixed**: the public reviews feed
returns all of a pharmacy's reviews to any authenticated caller, which works only
because the Go `pgxpool` role bypasses RLS. If review reads are ever moved to
Supabase REST, the feed would silently narrow to the caller's own reviews. No
security exposure — recorded here so the two layers aren't assumed interchangeable.

## Consequences

### Positive
- Customers can now actually browse and choose among pharmacies by proximity,
  location, or rating — closing the gap between the mobile UI and the backend.
- The geo pattern is now proven twice (vet, pharmacy); lab can adopt the same
  shape with near-zero new design cost.
- Reviews are cheap to reason about: append-only, one per order, trigger-kept
  aggregate — no read-time fan-out query, no reconciliation job.
- Brownfield-safe: zero changes to `pharmacy_products`, `pharmacy_orders`,
  `health_providers`, or the vet/lab verticals.

### Negative / trade-offs
- `pharmacy_provider_profiles` is a second row per pharmacy to keep in sync
  conceptually (address/hours living apart from the `health_providers`
  identity row) — acceptable given it avoids polluting a shared table.
- No review edit/delete path yet; a mis-rated order has no correction route
  beyond admin intervention. Deferred — not required for discovery to work.
- Distance sort re-scans `health_providers` with `ST_DWithin` per request; fine
  at current pharmacy counts, same ceiling the vet vertical already accepted.

### Deferred (explicitly out of scope for this pass)
- Provider-side profile UI (the owner-facing form for address/hours/fee) —
  the API exists (`POST /pharmacy/pharmacies/{id}/profile`); no mobile screen
  wired yet.
- A real map view in `pharmacy-select.tsx` (currently a static placeholder
  panel) — out of scope; proximity sort/labels are wired, map rendering is not.
- Cross-vertical (`vet`, `lab`) reuse of `pharmacy_provider_profiles`'s shape —
  intentionally pharmacy-named for now; generalizing is a follow-up ADR if/when
  vet/lab need the same fields.
