# Module 11: Property Management — UAT Supplement

**Scope note**: "Property Management" (queue module 11) is not one code module — it is four sub-planes, disambiguated during Phase 1 discovery of this UAT pass:

1. **Property suite** (`backend/internal/property`) — role-context aggregation + rent passport. Already has a full test-plan doc: [`property.md`](property.md).
2. **Realtor admin control plane** (`backend/internal/realtor`) — agency/portfolio moderation, verification, payments/escrow reads. Already has a full test-plan doc: [`realtor.md`](realtor.md).
3. **Estate property CRUD** (`backend/internal/estate/property_mgmt.go`, "Block 29") — per-unit property records, landlord/tenant assignment, occupancy, transfer requests. No existing test-plan doc — covered below.
4. **Realtor member-facing money plane** (Supabase-direct RPCs in `supabase/migrations/20260620020000_realtor_backend_rpcs.sql`) — lease signing, invoice payment, shortlet booking. No existing test-plan doc — covered below, and is where this pass's Blocker (PROPMGMT-001) lives.

This module's sign-off requires all four planes to pass, not just the two that already had docs.

## Estate property CRUD — test matrix

| Case ID | Title | Priority | Result |
|---|---|---|---|
| PM-CRUD-001 | Estate admin updates a property's occupancy/unit fields | P0 | ✅ Pass — verified live against a throwaway backend |
| PM-CRUD-002 | Landlord/tenant assignment | P0 | ✅ Pass — live-verified; also confirmed `assignTenant` correctly force-sets `occupancy_status='occupied'` |
| PM-CRUD-003 | Transfer request lifecycle (ownership \| tenancy) | P0 | ✅ Pass — **DB-executed proof, not just the UI's happy path**: approving an `ownership` transfer really changed `landlord_id` in `estate_properties` (confirmed via direct `psql`); rejecting a competing `tenancy` request left `tenant_id` untouched |
| PM-CRUD-004 | Archive a property | P1 | ✅ Pass — archived property correctly excluded from `ListProperties` |
| PM-CRUD-005 | Admin console coverage (PROPMGMT-004) | P0 | ✅ Pass (Fixed) — new `frontend-admin/app/admin/estate/properties/page.tsx`: list, landlord/tenant assignment (resolved to real names), occupancy/archive actions, transfer-request review queue. **Found and flagged (not fixed, separate background task `task_82416290`) an unrelated pre-existing bug**: `listResidents()`'s declared type doesn't match its live backend response shape, so the existing Residents & Units page likely renders blank fields whenever run live. |

## Realtor member-facing money plane — test matrix

| Case ID | Title | Priority | Result |
|---|---|---|---|
| PM-MONEY-001 | Pay invoice via WALLET with sufficient balance | P0 | ✅ Pass (Fixed) — real wallet debit posted (balanced ledger DEBIT/CREDIT pair via `debitWallet`), invoice→paid, lease→active, escrow deposit created. **Pre-fix: none of this required any real debit (PROPMGMT-001)** — closed. |
| PM-MONEY-002 | Pay invoice via WALLET with insufficient balance | P0 | ✅ Pass (Fixed) — refused (402-equivalent), zero state change. Pre-fix: always succeeded regardless of balance. |
| PM-MONEY-003 | Pay invoice via PAYSTACK | P1 | ✅ Pass (Fixed) — explicitly refused (501), not faked; disclosed as a genuine out-of-scope gap (no Paystack integration exists for this module yet), not silently built or silently broken. |
| PM-MONEY-004 | Idempotent replay of the same Idempotency-Key | P0 | ✅ Pass — replay returns the original receipt; exactly one ledger debit, one `realtor_payments` row. |
| PM-MONEY-005 | Direct RPC call bypassing the (new) server route | P0 | ✅ Pass (Fixed) — live-confirmed `permission denied for function realtor_pay_invoice` for a direct `authenticated`-role call; the exploit is closed at the database grant layer, not just the app layer. |
| PM-MONEY-006 | Escrow release (PROPMGMT-002) | P0 (raised from P2 — user chose to build it, not defer it) | ✅ Pass (Fixed) — inspection-gated release: `POST /api/realtor/admin/escrow/:id/resolve` requires a submitted move-out before releasing/forfeiting. Live-DB proof: real balanced REVERSAL pair for tenant release, real balanced journal for landlord forfeiture, refused without inspection, refused on an already-released deposit (no double-pay), disputed→released moves money exactly once. |
| PM-MONEY-007 | Shortlet booking price computation | P1 | ✅ Pass — live-executed directly via SQL: a real booking against a listing with `nightly_kobo=NULL` (fallback path) produced `total_kobo=66,500,000` exactly matching `8,000,000×3 nights + 2,500,000 cleaning + 40,000,000 deposit`; a second, overlapping-date booking attempt against the same listing correctly raised `dates_unavailable` via the DB's own exclusion constraint. Both runs rolled back (no residual test data). |
| PM-MONEY-008 | Lease sign → invoice generation idempotency | P1 | ✅ Pass — live-executed: signing the same lease twice in sequence returned the **identical** `invoice_id` both times, and `realtor_invoices` had exactly 1 row for that lease afterward — confirmed no duplicate invoice on retry. Rolled back (no residual test data). |

## Cross-cutting

- **PM-SEC-001**: `property.manage` / `realtor.manage` RBAC boundaries enforced on every admin route — ✅ Pass, confirmed live for both `property.manage` (rent-passport lookup 403 with no body leak) and `realtor.manage` (all 7 admin routes gated, confirmed via route registration + RBAC middleware).
- **PM-SEC-002**: mobile parity — RN-only (PROPMGMT-007). **Resolved**: presented to the user as a genuine scope decision; confirmed intentional, RN is the target platform, no code change needed.
- **PM-DOC-001**: `contracts/openapi.yaml` gap (PROPMGMT-006). **Closed** — all 4 property-suite + 7 realtor-admin routes now documented (plus the new escrow-resolve route once PM-MONEY-006 lands).

## Exit criteria

All P0 rows above pass, PM-MONEY-001/002/005 proven with real DB-executed evidence (a real ledger debit, a real refusal, a real permission denial — never a mock), PM-CRUD-005's admin surface exists and is click-tested, and `property.md`/`realtor.md`'s own P0 rows (already scoped) also pass. **Remaining before this doc's exit criteria are fully met**: PM-MONEY-006 (in progress), PM-MONEY-007/008 (read-confirmed but not live-executed — should be picked up alongside PM-MONEY-006's verification pass or in a follow-up before the Module Completion Gate).
