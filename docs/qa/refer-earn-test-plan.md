# Refer & Earn — UAT Test Plan

Module 8 in the fixed 21-module go-live queue. Built fresh from Phase 1 discovery findings (see §0 below) — no pre-existing test-plan artifact for this module.

Status legend: ✅ Pass · ❌ Fail · 🚫 Missing · ⚠️ Blocked · 🚧 Partial · 🔧 Fixed · 🏗️ Built · ⬜ Not Run

## 0. Discovery summary (Phase 1)

Three independent, simultaneously-live referral/reward implementations exist, not the "two systems" prior session memory suggested — that note **understated** the situation:

- **System A** ("§7A Referral Earning core") — `backend/internal/referral/*` (13 subpackages). Mounted `/api/finance/referral/*` (member), `/api/referral/admin/*` (admin). Flag: `FeatureReferralsEnabled`.
- **System B** ("Direct Referral Rewards Engine", newer, supersedes A per its own comments) — `backend/internal/finance/referrals/*`. Mounted `/v1/referrals/*` (member), `/v1/admin/referrals/*` (admin), `/internal/referrals/*` (webhooks). Flag: `FeatureReferralRewardsEnabled`.
- **System C** (Next.js-native, tied to vote-bridge) — `frontend-web/src/server/referrals/{service,attribution}.ts` — a flat ₦500 reward triggered when a referred user casts a vote, via `bridge_outbox` events.

**Both A and B are simultaneously enabled** in this environment. `referral_attributions` (System A's table) is correctly shared/reused by System B's migration — not duplicated. Three code-storage surfaces exist: `finance_referral_codes` (legacy/System C), `referral_links` (System B's canonical table, explicitly documented as distinct from the legacy seed), and System A's resolver only ever reads the legacy table.

Admin reporting/management is extensive for System A (`frontend-admin/app/admin/referral/**`) and System B (`frontend-admin/app/admin/referral-rewards/**`) — NOT a Blocker-severity gap, contrary to the default assumption. System C's ₦500 vote-triggered reward has no admin visibility anywhere found — a real, narrower gap (see REF-007).

Full findings, file:line citations, and money-path analysis are in the Phase 1 discovery report (summarized into REF-001 through REF-007 in §7 below).

## 1. Primary journeys

| ID | Case | Priority | Files | Steps | Expected | DB-executed proof needed? | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| RJ-001 | New user redeems a referral code at signup (System A path) | P0 | `attribution/service.go` | Sign up with a valid System-A-visible code | Attribution recorded, referrer's house account accrues | Y | ⬜ Not Run | |
| RJ-002 | New user redeems a referral code at signup (System B `referral_links` code) | P0 | `rewards_service.go`, `attribution/service.go` | Sign up with a code minted via System B | Attribution recorded correctly, NOT routed to house/invalid-code | Y | ✅ Pass | REF-002 fixed & live-verified |
| RJ-003 | Referrer earns a reward when referred user's purchase settles (System B) | P0 | `rewards_service.go OnPurchaseSettled` | Referred user completes a real purchase | `referral_rewards` row inserted, ledger credited exactly once, idempotency key `source_transaction_id` | Y | ⬜ Not Run | |
| RJ-004 | Reward reverses correctly on a refund (System B) | P0 | `rewards_service.go OnPurchaseRefunded` | Refund a purchase whose reward already credited | Balanced `PostReversal`, status flips CREDITED→REVERSED only | Y | ⬜ Not Run | |
| RJ-005 | Referrer earns ₦500 when referred user casts their first paid/free vote (System C) | P0 | `referrals/service.ts`, `voting-bridge/outbox.ts` | Referred user casts a vote | `bridge_outbox` row processed, wallet credited exactly once | Y | ✅ Pass | REF-001 fixed & live-verified |
| RJ-006 | Withdraw eligible referral earnings to wallet | P1 | `referral/ledger/withdraw.go` | Request withdrawal of accrued, non-house earnings | Real wallet credit, ledger balanced, cannot withdraw house/notional balance | Y | ⬜ Not Run | |
| RJ-007 | View referral dashboard / earnings summary (mobile + web) | P1 | `EarnClient.tsx`, mobile `features/referral/**` | Load the referral home screen | Correct code, correct earnings total, correct tier shown | N | ⬜ Not Run | |
| RJ-008 | Admin views referral attribution/reward reports (System A + B consoles) | P1 | `frontend-admin/app/admin/referral/**`, `referral-rewards/**` | Load each admin report page | Data matches underlying DB | N | ⬜ Not Run | |

## 2. Edge cases

| ID | Case | Priority | Expected | DB-executed proof needed? | Status | Notes |
|---|---|---|---|---|---|---|
| RE-001 | Duplicate `referral.triggered` outbox event for the same vote | P0 | Exactly one ₦500 credit, never two | Y | ⬜ Not Run | |
| RE-002 | `referral.triggered` event drained by the generic outbox worker instead of the dedicated route | P0 | Must still credit | Y | ✅ Pass | REF-001 fixed |
| RE-003 | Referral code minted by System B, used at signup routed through System A's resolver | P0 | Must attribute correctly | Y | ✅ Pass | REF-002 fixed |
| RE-004 | Concurrent purchase-settled webhook retries for the same transaction (System B) | P0 | Exactly one reward row/credit (`source_transaction_id` UNIQUE) | Y | ⬜ Not Run | |
| RE-005 | Self-referral (referrer refers themselves) | P1 | Rejected | Y | ⬜ Not Run | |
| RE-006 | Referrer account closed/suspended after referral, before reward settles | P1 | Fails safely, no orphaned credit | N | ⬜ Not Run | |
| RE-007 | Invalid/malformed/expired referral code at signup | P1 | Clean rejection, no attribution, no crash | N | ⬜ Not Run | |
| RE-008 | Currency/precision: reward computed from a margin with a fractional-kobo edge case | P1 | Correct `floor()` truncation, matches System B's documented rounding | Y | ✅ Pass | Confirmed via REF-005's new tests |
| RE-009 | Legacy lowercase-hex referral code resolved through signup attribution | P1 | Resolves correctly | ❌ Fail | REF-008 — case-sensitivity mismatch between the legacy generator and `normalizeCode()`, found while fixing REF-002, flagged not fixed |

## 3. Cross-cutting concerns

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| RC-001 | 8 System A member routes reachable at their documented path | P0 | 200/expected response, not 404 | ✅ Pass | REF-003 was already fixed in a prior commit; discovery misread a historical comment |
| RC-002 | Referral code format is consistent regardless of which stack generates it | P2 | One format | ❌ Fail | See REF-004 |
| RC-003 | Every referral reward credit emits a durable, queryable audit trail | P0 | Present | ⬜ Not Run | |
| RC-004 | Authz: a user cannot view/claim/withdraw another user's referral earnings | P0 | Rejected | ⬜ Not Run | |
| RC-005 | Admin referral routes require real admin RBAC (not the WAL-010-class fail-open) | P0 | Rejected for non-admin | ⬜ Not Run | Re-check independently — WAL-010's fix was app-wide but confirm this module's specific routes |

## 4. Admin portal

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| RA-001 | System A admin console (dashboard, attribution, house, campaigns, gamification, risk, compliance, merchants, finance, analytics, users) loads and shows accurate data | P1 | Accurate | ⬜ Not Run | |
| RA-002 | System B admin console (config, ledger, fraud, milestones, module-status, analytics, case) loads and shows accurate data | P1 | Accurate | ⬜ Not Run | |
| RA-003 | System C (₦500 vote-triggered reward) has ANY admin visibility | P2 | Missing (confirmed gap) | 🚫 Missing | REF-007 |
| RA-004 | Risk/fraud review queue and clawback tooling functions | P1 | Functional | ⬜ Not Run | |

## 5. Non-functional

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| RN-001 | Money-crediting logic (`rewards_service.go`, System C `service.ts`) has test coverage | P0 | Tests exist | 🔧 Fixed | REF-005 — 22 new tests added, all passing incl. `-race`, no new bugs found |
| RN-002 | Concurrency at scale: many simultaneous referral triggers for the same referrer | P0 | No lost/duplicate credits | ⬜ Not Run | |
| RN-003 | Secrets exposure: no leaked referral codes/PII in logs | P1 | Clean | ⬜ Not Run | |

## 6. Rollup

**Batch 1 status**: the discovery-driven bug hunt is closed out — 4 of 7 discovery findings (REF-001, REF-002, REF-003, REF-005) resolved (3 fixed, 1 corrected as a false positive), 1 new finding disclosed (REF-008), 2 left open pending a scope/priority decision (REF-004 code-format inconsistency, REF-006 documented merchant-settlement stub, REF-007 admin-visibility gap). The rows directly exercised by these fixes (RJ-002, RJ-005, RE-002/003/008/009, RC-001, RN-001) now have a recorded outcome. **The bulk of the primary-journey, edge-case, cross-cutting, admin-portal, and non-functional test-plan rows have NOT yet been executed** (RJ-001/003/004/006/007/008, RE-001/004/005/006/007, RC-002-005, RA-001-004, RN-002/003 all still ⬜ Not Run) — this module is not yet ready for a Module Completion Gate.

## 7. Defect log

### REF-001 — Vote-triggered referral reward has a silently-stubbed duplicate handler in the outbox drain path — FIXED
- **Description**: Two independent consumers drain `bridge_outbox` rows with `event_type='referral.triggered'`: `frontend-web/app/api/v1/referrals/outbox/route.ts` → `processReferralOutbox()` (real credit), and `frontend-web/src/server/voting-bridge/outbox.ts`'s `processPendingOutboxEvents` → `handleReferralTriggered()`, which was a literal `// TODO: Implement referral reward logic` stub that logged and returned `true` — marking the row `done` without crediting anyone. Confirmed live: neither drain path is actually wired to a cron/scheduler anywhere in the repo today, so this was a live trap for the first ops wiring rather than a currently-firing incident — but the risk was real and unrecoverable the moment either path got scheduled.
- **Root cause**: A second, generic outbox-draining worker was built for the vote-bridge with a stubbed referral handler, never wired up to the real credit logic built separately in `referrals/service.ts`.
- **Fix**: `handleReferralTriggered()` now calls the real `processReferralReward()` (the same function `processReferralOutbox()` uses) instead of stubbing out — both drain paths converge on one implementation. A malformed payload (missing `shareCode`/`voterId`) is marked done rather than retried forever; a thrown error returns `false` so the caller's existing retry logic applies.
- **Test**: New `tests/unit/voting-bridge/outbox-referral-convergence.spec.ts` (5 tests, in-memory) + `tests/integration/referrals/outbox-referral-live.test.ts` (2 tests, real local Postgres). **Live SQL proof**: a real `bridge_outbox` row drained through the fixed function produced exactly one `CREDIT` ledger row (₦500, correctly keyed idempotency key) and the outbox row correctly marked `done`; a duplicate row drained through BOTH paths still produced exactly one credit, never two. `npx vitest run`: 1077/1081 (same 2 pre-existing unrelated failures, zero new). `npx tsc --noEmit` clean.
- **Status**: Closed.

### REF-002 — System A's attribution resolver never sees codes minted by System B's canonical table — FIXED
- **Description**: System B's `resolveCode()` (`rewards_service.go`) correctly checks `referral_links` then falls back to `finance_referral_codes`. System A's attribution resolver (`attribution/service.go`) was wired to System B's OLDER `Service.ResolveCodeToReferrer`, which only queried `finance_referral_codes` — never `referral_links`. A code issued by the newer engine was invisible to System A's signup attribution, routed to the house account with a false "invalid code" risk flag.
- **Root cause**: System A was wired to an older resolver method that predates System B's `referral_links` table.
- **Fix**: New `RewardService.ResolveCodeToReferrer()` adapter in `rewards_service.go`, wrapping the already-correct private `resolveCode()` to satisfy the `CodeResolver` interface. Both wiring sites in `referral_routes.go` (`newAttributionService`, `RegisterReferral`) now construct `referrals.NewRewardService(...)` instead of the legacy `referrals.NewService(...)` — a drop-in swap, no duplicated lookup logic.
- **Test**: New live-DB tests in `rewards_service_test.go` and a new `attribution/resolve_code_live_test.go` — all passing against real Postgres (with and without `-race`), independently re-run by the orchestrating session. **Live before/after proof**: with the fix stashed, a code minted only into `referral_links` resolved to `is_house=true, risk_flag="invalid_code"`; with the fix restored, the same code resolved to the correct real referrer with no risk flag. Confirmed the reverse case (a legacy-table-only code) still resolves correctly, and a genuinely nonexistent code still correctly routes to the house. `go build`/`go vet` clean.
- **Status**: Closed.

### REF-003 — 8 System A member routes unreachable due to a double route-group mount — ALREADY FIXED (Phase 1 discovery false positive)
- **Description**: `backend/internal/app/referral_routes.go` carries a comment (around lines 99-103) explaining that grouping `/referral` again would have mounted 8 member routes at `/api/finance/referral/referral/*` instead of `/api/finance/referral/*`. Phase 1 discovery misread this as a live, uncorrected bug.
- **Correction**: The comment is historical documentation of a fix already applied in commit `848d0892` ("fix(referral): mount member routes at the path clients actually call"), which was already an ancestor of this branch's HEAD before this UAT pass began. The current code reads `mg := member` (not `member.Group("/referral")`), exactly matching the pattern the comment describes as correct. **Live-verified**: all 8 routes respond correctly at their short path on a throwaway backend instance; the old doubled path correctly 404s with nothing listening there; the `[GIN-debug]` route-registration log shows each route mounted exactly once, at the correct path. No client (web or mobile) was found calling the doubled path either.
- **Status**: Closed — not a defect, discovery error corrected.

### REF-004 — Two different referral-code generators write incompatible formats into the same table
- **Description**: `finance_referral_codes.code` is populated by `backend/internal/finance/referrals/service.go:119-125` (Go: 8 lowercase hex chars) OR `frontend-web/src/server/referrals/service.ts:28-35` (Next.js: `SPOT-XXXXXX`, 6 chars from a curated alphabet), depending on which stack creates the row first. No shared format contract.
- **Root cause**: Two independent implementations writing to the same legacy table without a shared code-generation contract.
- **Severity**: Medium (inconsistent UX, no money-safety impact — codes still resolve correctly within their own table).
- **Status**: Open, pending decision on which format to standardize on.

### REF-005 — Zero test coverage for the actual money-crediting logic in Systems B and C — FIXED
- **Description**: No test file existed for `rewards_service.go`'s `OnPurchaseSettled`, `OnPurchaseRefunded`, `RecalculateTiers`, `AdjustCase`, or milestone awarding. Zero tests existed for `frontend-web/src/server/referrals/service.ts` or `attribution.ts` (System C's ₦500 credit path).
- **Fix**: New `backend/internal/finance/referrals/rewards_service_test.go` (11 live-DB tests: happy-path credit, fractional-kobo truncation, idempotent replay, no-attribution/self-referral/non-positive-margin no-ops, refund reversal + its own idempotency, refund-on-non-CREDITED no-op) and new `frontend-web/tests/unit/wallet/referrals-service.spec.ts` (11 tests: correct credit/idempotency-key shape, replay no-op, code resolution normalization, attribution success/idempotent/self-referral/invalid-code paths). No new bugs found in either path — both behaved exactly as documented under test (floor-truncation, idempotency, fail-closed self-referral). All tests passing, including `-race`. One documentation nuance surfaced: `attribution.ts`'s self-referral handling is a silent house-account redirect with a risk flag, not a hard rejection — tested precisely as implemented, not as originally assumed.
- **Status**: Closed.

### REF-008 — Legacy referral codes are unresolvable through attribution due to a case-sensitivity mismatch (found while fixing REF-002, not fixed here)
- **Description**: `finance/referrals/service.go`'s `generateCode()` produces lowercase hex codes, but `attribution.normalizeCode()` uppercases the input before lookup — so a legacy code issued via the live `GET /finance/referrals/me` endpoint is unresolvable through signup attribution, independent of and in addition to REF-002.
- **Root cause**: The two functions were written with inconsistent case conventions and never reconciled.
- **Severity**: Medium (a real, additional signup-attribution failure mode for legacy codes — distinct from REF-002's now-fixed table-visibility gap).
- **Status**: Open — flagged as a separate background task by the fixing agent (not built here, correctly disclosed rather than silently patched or ignored).

### REF-006 — Merchant settlement hook is a documented nil-stub; missing per-campaign conversion counter
- **Description**: `backend/internal/referral/merchant/service.go` wires merchant settlement behind a `SettlementHook` interface with a nil no-op stub ("wired later"). `handlers.go:101` has a TODO for a missing per-campaign conversion counter in the model.
- **Root cause**: Honestly-labeled incomplete feature, not a silent failure.
- **Severity**: Low.
- **Status**: Open, logged for awareness — not a defect in what's built, a documented gap in what isn't.

### REF-007 — System C's ₦500 vote-triggered referral reward has no admin visibility anywhere
- **Description**: Systems A and B both have extensive admin consoles. System C's vote-triggered reward activity (a real money-crediting path) has no admin report, dashboard, or management surface found anywhere in `frontend-admin`.
- **Root cause**: System C was built without an accompanying admin surface.
- **Severity**: Enhancement/Moderate (a real money-moving feature with no admin oversight — worth building, not urgent enough to block on its own if the underlying credit logic is fixed and correct).
- **Status**: Open, logged for triage.
