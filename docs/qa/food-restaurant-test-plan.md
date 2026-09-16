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
| FA-001 | Restaurant list/detail/menu editor loads and writes real data | P1 | Accurate, real writes | ✅ Pass | Real HTTP create/edit/menu-category calls all persisted correctly, DB-confirmed |
| FA-002 | Dispatch board loads real rider/queue data (not the stale "mock-first" comment) | P1 | Real data | ✅ Pass | Confirmed live-wired to real handlers; the "mock-first" UI comment is stale/cosmetic only |
| FA-003 | Disputes resolution (approve/reject, refund/clawback trigger) | P0 | Functional, correct money movement | 🔧 Fixed | **FOOD-004** — was moving zero money despite claiming to; now dispatches food disputes to the real refund-cap/tip-clawback engine. Live-verified before/after |
| FA-004 | Payout runs (build, process, view history) | P0 | Functional, balanced ledger | ✅ Pass | Real HTTP build+process produced a genuine balanced double-entry, DB-confirmed |
| FA-005 | Withdrawals | P0 | Functional | 🔧 Fixed | **FOOD-005** — backend routes + admin console page built and live-verified end to end (request → admin mark-paid/failed, real balanced ledger legs). Member-facing (mobile/web) request UI still doesn't exist — logged separately as **FOOD-006**, not fixed here (larger, distinct scope) |
| FA-006 | Moderation, unclaimed-listing handling | P2 | Functional | 🚧 Partial | Moderation confirmed functional with real writes. Unclaimed-listing read confirmed live; the claim-decision workflow itself wasn't exercised (no fixture existed) |
| FA-007 | KYB onboarding review | P0 | Functional — this is the exact surface the mock-mode incident (709 stuck outlets) happened on; confirm the fix holds | 🔧 Fixed | **FOOD-003** — closed both compounding gaps (missing submission routes + admin approval silently skipping `kyb_status`). Live-verified: an approved restaurant's payout-readiness now correctly shows payable |

## 5. Non-functional

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| FN-001 | Full live-DB test suite (30 `_live_db_test.go` files) actually passes | P0 | 100% green | ✅ Pass | Confirmed clean against real local Postgres, including `-race` |
| FN-002 | `payout.go ProcessRun` has real, not just transitive, test coverage | P0 | Confirmed or gap closed | 🔧 Fixed | **FOOD-001** — confirmed zero coverage existed (`grep` for `ProcessRun` in any test file returned nothing); 6 new live-DB tests added covering happy path, double-payment protection, mixed-provider batches, concurrent-claim single-winner, and unknown-run handling. While adding this coverage, found and fixed a real bug — **FOOD-002**, see defect log |
| FN-003 | Concurrency at scale: many simultaneous orders against one restaurant/rider | P1 | No lost/duplicate escrow or settlement | ⬜ Not Run | |
| FN-004 | Secrets exposure: no leaked payment/bank details in logs | P1 | Clean | ⬜ Not Run | |

## 6. Rollup

**Batch 1 status**: 7 real defects found (FOOD-001 through FOOD-007), 5 fixed (FOOD-001/002/003/004/005), 2 disclosed and logged for a future batch (FOOD-006 member-facing withdrawal UI, FOOD-007 latent disburser gap). Three of the five fixes were Blocker-severity — every one of them was invisible from a code review alone and only surfaced through live HTTP/admin-console verification, despite this module's genuine engineering maturity (104 commits, real ADRs, 62 test files). Full `restaurant` + `finance` test trees re-run clean including `-race`, zero regressions. `frontend-admin` type-check clean.

**Not yet executed**: the bulk of the primary-journey/edge-case/cross-cutting rows this batch didn't directly touch (FJ-001/002/003/006/007/008, all of FE-001..008, FC-001/002/003/006, FN-003/004) — this module is not close to a Module Completion Gate. The three fixes closed real, severe gaps, but a full test-plan execution pass (order placement, escrow, dispute edge cases, concurrency at scale, authz) has not happened yet.

## 7. Defect log

### FOOD-001 — `payout.go`'s `ProcessRun`/`BuildRun` disbursement logic had zero test coverage — FIXED
- **Description**: `backend/internal/restaurant/payout.go` — the actual functions that post real money transfers to restaurant owners and riders — had no test file at all. The only payout-adjacent test (`payout_readiness_live_db_test.go`) covers a separate, read-only eligibility-check file, not the disbursement transfer logic.
- **Fix**: New `payout_processrun_live_db_test.go` (6 tests): happy path (real balanced double-entry, DB-confirmed), double-payment protection (replay + a second run over an already-claimed settlement), mixed-provider batch (restaurant + rider runs never cross-credit), concurrent-claim single-winner (5 racing goroutines, exactly one transfer lands), and unknown-run clean failure.
- **Status**: Closed.

### FOOD-002 — A crash between posting the payout ledger transfer and finalising the run leaves it stuck at 'processing' forever, though the money already moved — FIXED
- **Description**: Found while writing FOOD-001's tests. `ProcessRun`'s real sequence is: (1) atomically claim `draft→processing`, (2) post the ledger transfer, (3) atomically finalise `processing→paid`. If the process dies between (2) committing and (3) committing, the run is stuck at `processing` permanently — a retry's claim requires `status='draft'` (fails), falls through to the `existing.Status` check, sees `processing` (not `paid`), and returns a bare "not disbursable" error forever. The money already moved; nothing ever re-checks that and finalises the run. Confirmed no reconciler/cron/admin-retry path exists anywhere in the codebase for this state.
- **Root cause**: The finalise step's only success path assumed it would always run in the same call as the post; no recovery branch existed for the two committing separately across a crash.
- **Fix**: The `existing.Status == PayoutStatusProcessing` fallback now calls `ledger.Posted()` (an existing helper, already used by 6 other callers in this codebase for exactly this "did my transfer already land" crash-recovery check) against the run's own idempotency key. If the transfer already posted, the run is finalised to `paid` right there — idempotently, guarded by the same `WHERE status='processing'` pattern as the original finalise — instead of erroring forever.
- **Test**: New `TestLiveDB_ProcessRunRecoversFromCrashBetweenPostAndFinalise` — manually reproduces the exact crash window (claims the run, posts the real transfer, deliberately skips finalising), then calls `ProcessRun` again exactly as an operator retrying a stuck run would; confirms it now recovers to `paid` using the SAME transfer (wallet balance unchanged by the recovery call — no double-pay). Full package suite (including the 6 new FOOD-001 tests): all pass with `-race`.
- **Status**: Closed.

### FOOD-003 — Restaurant KYB approval is broken end-to-end; every restaurant approved through the live console today is permanently unpayable — FIXED
- **Description**: Two compounding gaps. (1) `kyb_handler.go`'s `SaveKYB`/`AddKYBDocument`/`SubmitKYB`/`GetKYB` are never registered on any route — live-confirmed 404 on both submit and read. No restaurant owner can ever create a real `restaurant_kyb` row through the live product. (2) `admin_repo.go`'s `AdminDecideApplication`: when no KYB row exists (`hasKYB==false` — true for every restaurant today, per (1)), approving sets `restaurants.is_open=true` but never touches `restaurants.kyb_status` (that update only runs inside the `if hasKYB` branch) — so `payout.go`'s `AND res.kyb_status='approved'` gate refuses that restaurant's payouts forever. Live-confirmed: an admin-approved test restaurant's `GET /api/finance/restaurant/payout-readiness` (as the owner) returned `{"kyb_status":"none","payable":false,"reason":"Business verification not started..."}` — after admin approval.
- **Root cause**: The `USE_MOCK=false` admin-console fix (which closed the ORIGINAL 709-stuck-outlets incident this module's own code comments describe) only stopped writes from landing in a fake in-memory array. It did nothing for this second, independent gap in the real write path itself.
- **Fix**: (1) Registered the 4 owner-facing KYB routes on `/api/finance/restaurant/:id/kyb*`. (2) `AdminDecideApplication` now writes `restaurants.kyb_status` directly when no formal KYB row exists — the interpretation chosen (documented in the code): the console's approve/reject action IS the verification decision in that case, since there's no separate KYB record to defer to; this also self-repairs any restaurant already stuck in the broken state simply by re-running the decision. When a formal KYB row DOES exist, the original stricter state-machine-guarded path is untouched.
- **Test**: New `TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable` — reproduced the original bug live first (pre-fix: `kyb_status` stays NULL, `payable` stays false after approval), then confirmed the fix (post-fix: `kyb_status='approved'`, `payable=true`, no blocking reason). Full `restaurant` package (69s, incl. `-race`) re-run clean, zero regressions.
- **Status**: Closed.

### FOOD-004 — Admin-resolved food-delivery disputes never move any money, despite claiming to — FIXED
- **Description**: The admin console's dispute-resolve action sends `{resolution, admin_note, refund_kobo}` to `POST /api/finance/admin/disputes/:id/resolve`, and the service code's own comment claims "posts the reversing ledger entry on refund." The actual handler (`internal/finance/disputes/service.go:69 Resolve()`) is a bare `UPDATE disputes SET status='resolved'...` — it never reads `refund_kobo` at all, never posts a ledger entry, never triggers a tip clawback. Live-confirmed: resolving a real food dispute with a refund returns 200 and flips `disputes.status`, but `ledger_entries` count is unchanged and `restaurant_dispute_refunds`/`restaurant_dispute_tip_clawbacks` both stay at 0 rows. Meanwhile a real, correct implementation (`restaurant/disputes_service.go:112 AdminResolveFoodDispute`, with the refund-cap and tip-clawback logic this module's own ADRs describe) exists but is unreachable — no route registers it. A code comment in `finance_routes.go` explicitly documents the ("Disputes are NOT here — the console reuses /api/finance/{disputes,admin/disputes}") consolidation decision, but that consolidation was never actually finished: the generic disputes module was never wired to dispatch food-delivery disputes to the real logic.
- **Root cause**: An intentional route-consolidation decision whose implementation was never completed.
- **Fix**: The generic `disputes.Service` now checks the dispute's `module_type` (real stored value confirmed `"food"`, matching independently) — for food disputes it delegates to a new injected `FoodDisputeResolver` (wired to the real `restaurant.Service.ResolveGenericDispute`, which translates the frontend's coarse vocabulary into the module's own refund-cap/clawback enums and re-derives/re-caps the budget under its own advisory lock, so a stale read can't cause an over-refund) instead of the bare status-flip. Every other module_type keeps the original unchanged behavior — no other admin service in the codebase relies on money movement through this generic path, confirmed by grep. Fails closed (errors) rather than silently no-op'ing if a food dispute reaches this path with no resolver wired.
- **Test**: 3 new live-DB tests, including one proving the tip-clawback delegation specifically (a full refund on an order where the rider was already paid claws the tip back through the exact same generic entrypoint) and one proving non-food disputes are completely unaffected. **Live before/after proof**: before, resolving a real dispute with `refund_kobo=855000` produced zero ledger movement; after, a real balanced reversal posted and the customer's wallet credited exactly ₦8,550.00; a replay correctly 422'd rather than double-refunding. Full `finance`+`restaurant` test tree re-run clean, zero regressions.
- **Status**: Closed.

### FOOD-005 — No withdrawal route or admin UI exists anywhere, despite a complete backend service already built — FIXED
- **Description**: `backend/internal/restaurant/withdrawal.go` fully implements `RequestWithdrawal`/`ListWithdrawals`/`MarkWithdrawalPaid`/`MarkWithdrawalFailed` against a real `restaurant_withdrawals` table — but none of it is registered on any route (owner-facing or admin), and `frontend-admin/app/admin/restaurant/` has no `withdrawals/` directory at all. This is distinct from the working `payouts` surface (which pays a provider FROM the platform's settlement account INTO their wallet) — withdrawal is the separate, subsequent step of moving money FROM the wallet OUT to a bank account, and that step was completely unreachable.
- **Root cause**: A complete backend implementation was built but never wired to any route, flag, or UI.
- **Fix**: New `FeatureRestaurantWithdrawalsEnabled` flag (default OFF) gates the actual money-moving `RequestWithdrawal` call specifically — deliberately left off pending a separate, disclosed gap: `disbursement_adapter.go`'s `RegistryDisburser` never populates the recipient's bank fields on the outbound disburse request, so wiring a live payout provider today would fire a real transfer with an empty account number/name. Owner routes (`bank-accounts` CRUD + `withdrawals` request/list/get — bank-accounts had no route either, needed just to test a withdrawal at all) and admin routes (list/get/mark-paid/mark-failed, behind a new `restaurant.admin.withdrawals` permission via an additive migration) are mounted regardless, since the flag alone controls the money path. New admin console page mirroring the existing `payouts/page.tsx` structure exactly, with the same fixture-mode write-refusal guard the rest of the console already uses.
- **Test**: 7 new live-DB tests (reserve posts a balanced leg + debits the wallet; over-withdrawal refuses cleanly with zero side effects; idempotent replay is a safe no-op; mark-paid settles without re-touching the wallet and rejects a second reversal; mark-failed restores the wallet correctly and rejects a second pay; admin list/get are unscoped and filter correctly; flag-off refusal). **Live end-to-end proof**: a funded merchant requested a real ₦1,200 withdrawal (balanced ledger leg, wallet correctly debited); an over-withdrawal attempt correctly refused with zero rows created; an admin (real RBAC role) marked it paid (settle leg posted, wallet unchanged as expected) and a second withdrawal marked failed (reversal posted, wallet correctly restored — verified against the real balance-projection formula, not a naive sum); a non-admin token hitting the admin route got a clean 403.
- **Not fixed here, flagged separately**: no member-facing (mobile or web) UI exists anywhere to request a withdrawal — building one is a distinct, larger scope than wiring the existing backend/admin surface. The `RegistryDisburser` bank-field gap noted above is also flagged, not fixed, since it's outside this specific defect's scope.
- **Status**: Closed (backend + admin surface). Member-facing withdrawal-request UI remains a separate, disclosed gap.

### FOOD-006 — No member-facing (mobile or web) UI exists to request a restaurant/rider withdrawal (found while fixing FOOD-005, not fixed)
- **Description**: FOOD-005's fix wired real backend routes and an admin console view/action for withdrawals, but confirmed (checked `mobile-app/reactnative/src/features/restaurantmerchant/` and rider-side screens) that no UI anywhere lets a restaurant owner or rider actually request a withdrawal — the routes are reachable via direct API call only.
- **Severity**: Major (a real feature gap — money can accrue in a provider's wallet with no self-service way to cash it out — but the admin side CAN process a withdrawal an ops agent creates on the provider's behalf via direct API today, so it's not a total dead end).
- **Status**: Open, logged for a future batch — genuinely new UI scope, not a mechanical fix.

### FOOD-007 — The live payout-provider disburser adapter never populates the recipient's bank details (found while fixing FOOD-005, not fixed)
- **Description**: `backend/internal/restaurant/disbursement_adapter.go`'s `RegistryDisburser` never sets `BankCode`/`AccountNumber`/`AccountName` on the outbound `WithdrawalDisburseRequest`. If a live payout provider registry were ever wired into `Service.WithWithdrawals`'s disburser (it currently stays at the default `NoopDisburser`, so this can't fire in production today), a real payout call would go out with an empty recipient.
- **Severity**: Medium (latent — only reachable if/when a live disburser is wired, which this batch deliberately did not do).
- **Status**: Open, logged for whoever wires a live disbursement provider for this module in the future.
