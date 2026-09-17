# Module 11: Property Management — UAT Supplement

**Scope note**: "Property Management" (queue module 11) is not one code module — it is four sub-planes, disambiguated during Phase 1 discovery of this UAT pass:

1. **Property suite** (`backend/internal/property`) — role-context aggregation + rent passport. Already has a full test-plan doc: [`property.md`](property.md).
2. **Realtor admin control plane** (`backend/internal/realtor`) — agency/portfolio moderation, verification, payments/escrow reads. Already has a full test-plan doc: [`realtor.md`](realtor.md).
3. **Estate property CRUD** (`backend/internal/estate/property_mgmt.go`, "Block 29") — per-unit property records, landlord/tenant assignment, occupancy, transfer requests. No existing test-plan doc — covered below.
4. **Realtor member-facing money plane** (Supabase-direct RPCs in `supabase/migrations/20260620020000_realtor_backend_rpcs.sql`) — lease signing, invoice payment, shortlet booking. No existing test-plan doc — covered below, and is where this pass's Blocker (PROPMGMT-001) lives.

This module's sign-off requires all four planes to pass, not just the two that already had docs.

## Estate property CRUD — test matrix

| Case ID | Title | Priority | Expected result |
|---|---|---|---|
| PM-CRUD-001 | Estate admin updates a property's occupancy/unit fields | P0 | 200; change persisted; non-admin resident blocked (403) |
| PM-CRUD-002 | Landlord/tenant assignment | P0 | Assignment succeeds for a valid resident id within the estate; assigning a user outside the estate rejected |
| PM-CRUD-003 | Transfer request lifecycle (ownership \| tenancy) | P0 | Request created → admin reviews (`approved`\|`rejected`) via `validTransferDecision` → approved request actually re-assigns landlord/tenant; rejected leaves assignment untouched |
| PM-CRUD-004 | Archive a property | P1 | Archived property excluded from active listings; still readable by admin |
| PM-CRUD-005 | Admin console coverage (PROPMGMT-004) | P0 | A real admin can view all estate properties, assign landlord/tenant, and approve/reject transfer requests through a UI — **currently impossible, zero admin surface exists** |

## Realtor member-facing money plane — test matrix

| Case ID | Title | Priority | Expected result |
|---|---|---|---|
| PM-MONEY-001 | Pay invoice via WALLET with sufficient balance | P0 | Real wallet debit posted (balanced ledger pair), invoice→paid, lease→active, escrow deposit created for the refundable portion — **pre-fix: none of this required any real debit (PROPMGMT-001)** |
| PM-MONEY-002 | Pay invoice via WALLET with insufficient balance | P0 | Refused (402-equivalent), zero state change — **pre-fix: always succeeded regardless of balance** |
| PM-MONEY-003 | Pay invoice via PAYSTACK | P1 | Either a real, verified Paystack capture, or an explicit "not yet supported" refusal — **pre-fix: silently marked paid with zero verification** |
| PM-MONEY-004 | Idempotent replay of the same Idempotency-Key | P0 | Second call returns the original receipt, zero double-debit, zero duplicate escrow row |
| PM-MONEY-005 | Direct RPC call bypassing the (new) server route | P0 | Refused — the RPC itself must not be callable by an ordinary authenticated client after the fix |
| PM-MONEY-006 | Escrow release (PROPMGMT-002) | P2 | No mechanism exists anywhere — disclosed gap, not fixed this batch |
| PM-MONEY-007 | Shortlet booking price computation | P1 | `total_kobo = nightly*nights + cleaning_fee + deposit`, matches listing's own rates; overlapping-dates booking rejected by the DB exclusion constraint |
| PM-MONEY-008 | Lease sign → invoice generation idempotency | P1 | Re-signing (or retrying) does not create a second invoice for the same lease |

## Cross-cutting

- **PM-SEC-001**: `property.manage` / `realtor.manage` RBAC boundaries enforced on every admin route (see `property.md` §6, `realtor.md`).
- **PM-SEC-002**: mobile parity — RN-only (PROPMGMT-007), flagged for the Module Completion Gate the same way Association's SECRETARY question was.
- **PM-DOC-001**: `contracts/openapi.yaml` gap (PROPMGMT-006) — disclosed, not blocking.

## Exit criteria

All P0 rows above pass, PM-MONEY-001/002/005 proven with real DB-executed evidence (a real ledger debit, a real refusal, a real permission denial — never a mock), PM-CRUD-005's admin surface exists and is click-tested, and `property.md`/`realtor.md`'s own P0 rows (already scoped) also pass.
