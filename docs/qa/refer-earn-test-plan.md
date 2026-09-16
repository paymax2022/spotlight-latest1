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
| RJ-002 | New user redeems a referral code at signup (System B `referral_links` code) | P0 | `rewards_service.go`, `attribution/service.go` | Sign up with a code minted via System B | Attribution recorded correctly, NOT routed to house/invalid-code | Y | ⬜ Not Run | Directly tests REF-002 |
| RJ-003 | Referrer earns a reward when referred user's purchase settles (System B) | P0 | `rewards_service.go OnPurchaseSettled` | Referred user completes a real purchase | `referral_rewards` row inserted, ledger credited exactly once, idempotency key `source_transaction_id` | Y | ⬜ Not Run | |
| RJ-004 | Reward reverses correctly on a refund (System B) | P0 | `rewards_service.go OnPurchaseRefunded` | Refund a purchase whose reward already credited | Balanced `PostReversal`, status flips CREDITED→REVERSED only | Y | ⬜ Not Run | |
| RJ-005 | Referrer earns ₦500 when referred user casts their first paid/free vote (System C) | P0 | `referrals/service.ts`, `voting-bridge/outbox.ts` | Referred user casts a vote | `bridge_outbox` row processed, wallet credited exactly once | Y | ⬜ Not Run | Directly tests REF-001 |
| RJ-006 | Withdraw eligible referral earnings to wallet | P1 | `referral/ledger/withdraw.go` | Request withdrawal of accrued, non-house earnings | Real wallet credit, ledger balanced, cannot withdraw house/notional balance | Y | ⬜ Not Run | |
| RJ-007 | View referral dashboard / earnings summary (mobile + web) | P1 | `EarnClient.tsx`, mobile `features/referral/**` | Load the referral home screen | Correct code, correct earnings total, correct tier shown | N | ⬜ Not Run | |
| RJ-008 | Admin views referral attribution/reward reports (System A + B consoles) | P1 | `frontend-admin/app/admin/referral/**`, `referral-rewards/**` | Load each admin report page | Data matches underlying DB | N | ⬜ Not Run | |

## 2. Edge cases

| ID | Case | Priority | Expected | DB-executed proof needed? | Status | Notes |
|---|---|---|---|---|---|---|
| RE-001 | Duplicate `referral.triggered` outbox event for the same vote | P0 | Exactly one ₦500 credit, never two | Y | ⬜ Not Run | |
| RE-002 | `referral.triggered` event drained by the generic outbox worker instead of the dedicated route | P0 | Must still credit — currently does NOT (REF-001) | Y | ❌ Fail | See REF-001 |
| RE-003 | Referral code minted by System B, used at signup routed through System A's resolver | P0 | Must attribute correctly — currently does NOT (REF-002) | Y | ❌ Fail | See REF-002 |
| RE-004 | Concurrent purchase-settled webhook retries for the same transaction (System B) | P0 | Exactly one reward row/credit (`source_transaction_id` UNIQUE) | Y | ⬜ Not Run | |
| RE-005 | Self-referral (referrer refers themselves) | P1 | Rejected | Y | ⬜ Not Run | |
| RE-006 | Referrer account closed/suspended after referral, before reward settles | P1 | Fails safely, no orphaned credit | N | ⬜ Not Run | |
| RE-007 | Invalid/malformed/expired referral code at signup | P1 | Clean rejection, no attribution, no crash | N | ⬜ Not Run | |
| RE-008 | Currency/precision: reward computed from a margin with a fractional-kobo edge case | P1 | Correct `floor()` truncation, matches System B's documented rounding | Y | ⬜ Not Run | |

## 3. Cross-cutting concerns

| ID | Case | Priority | Expected | Status | Notes |
|---|---|---|---|---|---|
| RC-001 | 8 System A member routes reachable at their documented path | P0 | 200/expected response, not 404 | ❌ Fail | See REF-003 — self-documented double-mount bug |
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
| RN-001 | Money-crediting logic (`rewards_service.go`, System C `service.ts`) has test coverage | P0 | Tests exist | 🚫 Missing | REF-005 — zero tests found for the actual credit/refund logic |
| RN-002 | Concurrency at scale: many simultaneous referral triggers for the same referrer | P0 | No lost/duplicate credits | ⬜ Not Run | |
| RN-003 | Secrets exposure: no leaked referral codes/PII in logs | P1 | Clean | ⬜ Not Run | |

## 6. Rollup

_Populated after Phase 3 execution completes._

## 7. Defect log

### REF-001 — Vote-triggered referral reward has a silently-stubbed duplicate handler in the outbox drain path
- **Description**: Two independent consumers drain `bridge_outbox` rows with `event_type='referral.triggered'`: `frontend-web/app/api/v1/referrals/outbox/route.ts` → `processReferralOutbox()` (real credit), and `frontend-web/src/server/voting-bridge/outbox.ts:69-146`'s `processPendingOutboxEvents` → `handleReferralTriggered()` (lines 185-201), which is a literal `// TODO: Implement referral reward logic` stub that logs and returns `true` — marking the row `done` without crediting anyone. `outbox.ts`'s own README (lines 181-191) documents this as "run periodically via cron or background worker." No cron/schedule config was found in the repo confirming which drain path actually runs in production.
- **Root cause**: A second, generic outbox-draining worker was built for the vote-bridge with a stubbed referral handler, never wired up to the real credit logic that was built separately in `referrals/service.ts`.
- **Severity**: Blocker (money-path — silent underpayment, no error, no retry).
- **Status**: Open, pending triage/swarm remediation.

### REF-002 — System A's attribution resolver never sees codes minted by System B's canonical table
- **Description**: System B's `resolveCode()` (`rewards_service.go:410-432`) correctly checks `referral_links` then falls back to `finance_referral_codes`. System A's attribution resolver (`attribution/service.go`) uses System B's OLDER `Service.ResolveCodeToReferrer` (`referrals/service.go:71-79`), which only queries `finance_referral_codes` — never `referral_links`. A code issued by the newer engine is invisible to System A's signup attribution, routed to the house account with a false "invalid code" risk flag.
- **Root cause**: System A was wired to an older resolver method that predates System B's `referral_links` table.
- **Severity**: High (real signup-attribution failures, referrers not credited for genuine referrals).
- **Status**: Open, pending triage/swarm remediation.

### REF-003 — 8 System A member routes unreachable due to a self-documented double route-group mount
- **Description**: `backend/internal/app/referral_routes.go:99-103` has a comment acknowledging that grouping `/referral` again mounted 8 routes (`/config`, `/my-attribution`, `/claim-code`, `/my-rewards`, `/withdraw-eligible`, `/withdraw`, `/invite/vanity` GET/POST) at `/api/finance/referral/referral/*` instead of `/api/finance/referral/*` — unreachable at the documented/expected path. Sibling `Register` functions (Econ, Trust) correctly avoid this.
- **Root cause**: Route-group nesting mistake, self-documented but not corrected.
- **Severity**: High (member-facing routes completely unreachable).
- **Status**: Open, pending triage/swarm remediation.

### REF-004 — Two different referral-code generators write incompatible formats into the same table
- **Description**: `finance_referral_codes.code` is populated by `backend/internal/finance/referrals/service.go:119-125` (Go: 8 lowercase hex chars) OR `frontend-web/src/server/referrals/service.ts:28-35` (Next.js: `SPOT-XXXXXX`, 6 chars from a curated alphabet), depending on which stack creates the row first. No shared format contract.
- **Root cause**: Two independent implementations writing to the same legacy table without a shared code-generation contract.
- **Severity**: Medium (inconsistent UX, no money-safety impact — codes still resolve correctly within their own table).
- **Status**: Open, pending decision on which format to standardize on.

### REF-005 — Zero test coverage for the actual money-crediting logic in Systems B and C
- **Description**: No test file exists for `rewards_service.go`'s `OnPurchaseSettled`, `OnPurchaseRefunded`, `RecalculateTiers`, `AdjustCase`, or milestone awarding. Zero tests anywhere for `frontend-web/src/server/referrals/service.ts` or `attribution.ts` (System C's ₦500 credit path). `frontend-web/tests/unit/voting-bridge/bridge.spec.ts` only asserts the outbox event is enqueued, never what processes it.
- **Root cause**: Test coverage was never built for these money-crediting paths.
- **Severity**: Medium/test-gap (the logic read as correct/idempotent on inspection, per the discovery report, but is unverified by any automated test).
- **Status**: Open, pending remediation.

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
