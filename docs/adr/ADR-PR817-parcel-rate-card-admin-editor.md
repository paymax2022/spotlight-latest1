# ADR-PR817: Parcel rate-card admin editor — transactional audit, update-only cells

**Status:** Accepted · **Date:** 2026-10-17 · **Area:** transport / mobility admin

## Context
`transport_parcel_rate_card` (zone × size × speed → `multiplier_bps`, `min_fare_kobo`, `active`)
prices parcels behind `FEATURE_PARCEL_RATE_CARD_ENABLED`. Admins needed to edit it without SQL.
The existing `PATCH /pricing` writes its audit row *after* the UPDATE, on the pool, and ignores
audit errors, so a change can land without being audited.

## Decision
1. `PATCH /admin/transport/parcel-rate-card/{size}/{speed}` reads the old cell `FOR UPDATE`, then
   runs the UPDATE and the `transport_audit_log` insert in **one transaction**. If the audit row
   cannot be written, the edit does not happen. `writeAudit` takes an `auditExecer` (a pool or a
   tx) so it can do this. Existing callers are unchanged.
2. **Update-only.** A missing cell returns 404. Creating zones or cells is out of scope, so a typo
   in the zone cannot create a new rate card.
3. Bounds are validated server-side before the DB is touched:
   - multiplier 1000–100000 bps, matching the CHECK
   - `min_fare_kobo` 0–100,000,000. This cap is stricter than the CHECK and catches typos.
   - a reason is required (at most 500 characters)
   - integers only: JSON floats are rejected rather than truncated
4. RBAC matches `/pricing`: `mobility.view` to read, `mobility.manage` to edit.
5. Edits reach the next estimate only. Card-checkout quotes keep their frozen cell
   (`parcelFrozenPricing.Rate`). This endpoint writes nothing except the rate card and the audit log.

## Consequences
- The wallet parcel booking reprices at book time, and the request has no expected fare. So an
  edit made between estimate and book changes the escrowed amount. `/pricing` already behaves
  this way. The follow-up is to add `expected_fare_kobo` and return 409 on a mismatch.
- An inactive cell falls back to legacy pricing without its own minimum fare. The UI says so.
- Concurrent edits: the last write wins. Every audit row is still exact. A stale-form 409
  (an `updated_at` precondition) can be added later if needed.
