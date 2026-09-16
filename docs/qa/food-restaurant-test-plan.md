# Food (Restaurant Ordering) — UAT Test Plan

Module 12 in the fixed 21-module go-live queue. Referred to as "Restaurant" throughout the codebase itself (`backend/internal/restaurant/`, `frontend-admin/app/admin/restaurant/`).

Status legend: ✅ Pass · ❌ Fail · 🚫 Missing · ⚠️ Blocked · 🚧 Partial · 🔧 Fixed · 🏗️ Built · ⬜ Not Run

## 0. Discovery summary (Phase 1)

Unlike every other module tackled so far in this queue, this one is **not** a from-scratch build — prior session memory (from outside this specific UAT engagement) claimed extensive prior engineering work under the name "Restaurant," and Phase 1 discovery independently verified this against the actual current codebase (104 commits touching `backend/internal/restaurant/`, real ADRs on disk, 62 test files including 30 live-DB integration tests) rather than trusting the memory at face value.

**Money path** (`backend/internal/restaurant/service.go`, `payout.go`, `disputes_service.go`, `tip_clawback.go`, `reconciler.go`): a fail-closed tier-gate escrow debit at `PlaceOrder` (80/10/10 restaurant/rider/platform split), a real disbursement subsystem (`BuildRun`/`ProcessRun` posting balanced ledger transfers, unique-indexed against double-disbursement), a dispute-refund cap keyed to the non-tip basis, a two-part-verified tip clawback (never assumes the rider was paid from `orders.rider_id` alone), and a crash-recovery reconciler for the delivered-but-unsettled race window. Reads as complete and reasoned-through, not stubbed.

**Admin console** (`frontend-admin/app/admin/restaurant/**`): comprehensive — restaurant list/detail/menu editor, dispatch board, disputes, payouts, withdrawals, KYB onboarding review, moderation, unclaimed-listing handling, delivery-fee config. `USE_MOCK` already defaults to live (`restaurantAdminService.ts:55`) — its own code comment documents a real prior incident this default caused (709 outlets stuck in an unmoved KYB state because a reviewer saw a fake success in mock mode) and the fix that followed. Two pages (dispatch, onboarding) still branch on `USE_MOCK` for some mutations; the rest call the live backend unconditionally.

**Two minor, non-money-path gaps found**: `staff_invite.go:110` and `service.go:1314` — both explicitly labeled TODOs for order/staff-invite audit-event logging, not wired to any audit infrastructure yet. One stale UI comment (`dispatch/page.tsx:422-423` claims "no admin-wide feed yet" — verified inaccurate; the real backend-wired feed already exists).

**What Phase 1 could NOT verify** (sandbox had no live DB connection): whether the 30 live-DB test files actually pass against a real Postgres; whether `payout.go`'s `ProcessRun` (the actual ledger-disbursement transfer) has dedicated test coverage or only transitive coverage via `payout_readiness_live_db_test.go`; whether the platform module-registry (`20261210000000_platform_module_registry.sql`) marks Food as live or "coming soon" in the actual DB row.

Given the module's maturity, Phase 2/3 here is weighted toward **verification of what's claimed to exist** (live-DB suite, admin console click-through with mock explicitly disabled — the exact methodology that caught real bugs in Crowdfunding/Association's admin consoles despite a clean code read) rather than assuming Blocker-severity "missing feature" gaps are likely.

## 1. Primary journeys

| ID | Case | Priority | Files | Steps | Expected | DB-executed proof needed? | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| FJ-001 | Browse restaurants, view menu, add to cart | P0 | `discovery_page.go`, `search.go`, mobile `app/food/` | Discover a restaurant, open menu, add items | Correct pricing, modifiers, availability | N | ⬜ Not Run | |
| FJ-002 | Place a real order — escrow debits correctly | P0 | `service.go PlaceOrder` | Place an order with a funded wallet | Tier gate passes, escrow debited exactly the order total, 80/10/10 split correct | Y | ⬜ Not Run | |
| FJ-003 | Order lifecycle / status transitions (accepted → preparing → ready → picked up → delivered) | P0 | order FSM, `fsm_expansion_test.go` | Drive a real order through its lifecycle | Only legal forward transitions succeed | Y | ⬜ Not Run | |
| FJ-004 | Order settles and restaurant/rider payout run processes | P0 | `payout.go BuildRun/ProcessRun` | Settle an order, run a payout | Balanced ledger transfer posted exactly once per settlement | Y | ⬜ Not Run | Direct test for the coverage gap Phase 1 flagged |
| FJ-005 | Customer disputes an order, gets a refund | P0 | `disputes_service.go` | File a dispute, resolve with a refund | Refund capped at non-tip basis, correct ledger reversal | Y | ⬜ Not Run | |
| FJ-006 | Rider tip clawback on a full-refund dispute | P0 | `tip_clawback.go` | Full-refund dispute where rider was actually paid the tip | Rider wallet debited (or queued PENDING if insufficient), customer credited | Y | ⬜ Not Run | |
| FJ-007 | Admin: restaurant/menu management, KYB onboarding review | P1 | `frontend-admin/app/admin/restaurant/{[id],onboarding}` | Full click-through, mock explicitly disabled | Real data, real writes | N | ⬜ Not Run | |
| FJ-008 | Admin: dispatch board, disputes, payouts, withdrawals, moderation, unclaimed | P1 | `frontend-admin/app/admin/restaurant/{dispatch,disputes,payouts,withdrawals,moderation,unclaimed}` | Full click-through, mock explicitly disabled | Real data, real writes | N | ⬜ Not Run | |

## 2. Edge cases

| ID | Case | Priority | Expected | DB-executed proof needed? | Status | Notes |
|---|---|---|---|---|---|---|
| FE-001 | PlaceOrder idempotency replay (same key) | P0 | Exactly one escrow debit, original result returned | Y | ⬜ Not Run | |
| FE-002 | Concurrent PlaceOrder for the same idempotency key | P0 | No double-escrow under real concurrency | Y | ⬜ Not Run | |
| FE-003 | Tier-limit exceeded at PlaceOrder | P0 | Fail-closed rejection, no partial state | Y | ⬜ Not Run | |
| FE-004 | Crash/race between `delivered` status and `settleOrder` | P0 | Reconciler recovers correctly, no double-settle | Y | ⬜ Not Run | Direct test of `reconciler.go`'s claimed purpose |
| FE-005 | ProcessRun double-disbursement attempt on the same settlement | P0 | Refused — unique index (`uq_restaurant_payout_lines_settlement`) holds | Y | ⬜ Not Run | |
| FE-006 | Rider wallet insufficient at tip-clawback time | P1 | Clawback queued PENDING, recovered off next settlement, never goes negative | Y | ⬜ Not Run | |
| FE-007 | Partial-refund dispute does NOT trigger tip clawback | P1 | Confirmed no clawback fires for restaurant-fault cases | Y | ⬜ Not Run | |
| FE-008 | Dispute refund on an order whose escrow never reached the rider (e.g. cancelled pre-pickup) | P1 | Correct, no phantom clawback attempt | Y | ⬜ Not Run | |

## 3. Cross-cutting concerns

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| FC-001 | Authz: a user cannot view/act on another user's orders, another restaurant's data | P0 | Rejected | ⬜ Not Run | |
| FC-002 | Admin RBAC on restaurant admin routes (not the WAL-010-class fail-open) | P0 | Rejected for non-admin | ⬜ Not Run | Re-check independently even though the app-wide WAL-010 fix should cover it |
| FC-003 | Every money mutation (escrow, settlement, payout, refund, clawback) emits a durable audit trail | P0 | Present | ⬜ Not Run | The two TODOs (`staff_invite.go:110`, `service.go:1314`) suggest a gap here — confirm scope |
| FC-004 | Order-event audit logging (the second TODO's subject) | P1 | 🚫 Missing (confirmed gap) | 🚫 Missing | `service.go:1314` — TODO, audit infrastructure not wired |
| FC-005 | Staff-invite audit logging (the first TODO's subject) | P2 | 🚫 Missing (confirmed gap) | 🚫 Missing | `staff_invite.go:110` — TODO, no audit collaborator wired |
| FC-006 | Platform module-registry status for Food | P2 | Marked live, not "coming soon" | ⬜ Not Run | Phase 1 could not query the actual DB row |

## 4. Admin portal

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| FA-001 | Restaurant list/detail/menu editor loads and writes real data | P1 | Accurate, real writes | ⬜ Not Run | |
| FA-002 | Dispatch board loads real rider/queue data (not the stale "mock-first" comment) | P1 | Real data | ⬜ Not Run | Confirm Phase 1's finding that this comment is stale |
| FA-003 | Disputes resolution (approve/reject, refund/clawback trigger) | P1 | Functional, correct money movement | ⬜ Not Run | |
| FA-004 | Payout runs (build, process, view history) | P1 | Functional, balanced ledger | ⬜ Not Run | |
| FA-005 | Withdrawals | P1 | Functional | ⬜ Not Run | |
| FA-006 | Moderation, unclaimed-listing handling | P2 | Functional | ⬜ Not Run | |
| FA-007 | KYB onboarding review | P1 | Functional — this is the exact surface the mock-mode incident (709 stuck outlets) happened on; confirm the fix holds | ⬜ Not Run | |

## 5. Non-functional

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| FN-001 | Full live-DB test suite (30 `_live_db_test.go` files) actually passes | P0 | 100% green | ⬜ Not Run | Phase 1 could not run this (no DB in its sandbox) |
| FN-002 | `payout.go ProcessRun` has real, not just transitive, test coverage | P0 | Confirmed or gap closed | ⬜ Not Run | Phase 1 flagged this as unclear |
| FN-003 | Concurrency at scale: many simultaneous orders against one restaurant/rider | P1 | No lost/duplicate escrow or settlement | ⬜ Not Run | |
| FN-004 | Secrets exposure: no leaked payment/bank details in logs | P1 | Clean | ⬜ Not Run | |

## 6. Rollup

_Populated after Phase 3 execution._

## 7. Defect log

_(populated as Phase 3 execution finds issues)_
