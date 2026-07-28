# Module: Academy Tutor (Marketplace + Payouts)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (tutor payout rail) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_TUTOR_ENABLED` (`FlagTutor` = `academy.tutor`; registered only inside `if tutorEnabled`)
**Code:** `backend/internal/academy/tutor/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `rails.go`, `tutor_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyTutor`, `academyKYC` adapter).
**Slug:** `TUTOR`

## 1. Overview & scope

Tutor marketplace: onboarding, KYC-gated verification (tier ≥ 1 via the `academyKYC` adapter over
`finance/kyc`), assignments/cohorts/submissions, grading, append-only earnings, and **payouts** via an
injected `PayoutRail`. Earnings are append-only; the payable balance is a **derived SUM** of pending
earnings (no shadow balance). `RequestPayout` requires an `Idempotency-Key`, checks the derived
balance fail-closed, is idempotent (unique key → one rail call), and flips covered earnings to paid; a
rail error drives the payout `requested → failed`. Verification is fail-closed: any KYC error or
sub-tier records `kyc_state='rejected'` and returns `ErrKYCNotMet`. Admin routes gated `academy.tutor`.

Applicable cross-cutting: `../cross-cutting/money-invariants.md` (payout idempotency/derived balance),
`../cross-cutting/kyc-and-tiers.md` (verify tier gate, fail-closed), `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md`, `../cross-cutting/webhooks-and-providers.md` (payout rail),
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`; admin routes guarded
`RequirePermission("academy.tutor")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Onboard tutor | `POST /tutor/onboard` | member (auth) | no |
| My tutor profile | `GET /tutor/me` | member; owner | no |
| Create / list assignments | `POST/GET /tutor/assignments` | member; owner | no |
| Cohorts / submissions | `GET /tutor/cohorts`, `GET /tutor/submissions` | member; owner | no |
| Grade | `POST /tutor/grades` | member; owner | no |
| Earnings | `GET /tutor/earnings` | member; owner | no |
| Request payout | `POST /tutor/payouts` | member; owner + `Idempotency-Key` | **yes** |
| Verified tutor listing | `GET /tutors` (`?subject=`) | member (auth) | no |
| Admin list tutors | `GET /tutor` | `academy.tutor` | no |
| Verify tutor | `POST /tutor/:id/verify` | `academy.tutor` (KYC tier ≥ 1 gate) | no |
| Suspend tutor | `POST /tutor/:id/suspend` | `academy.tutor` | no |
| Admin payouts | `GET /tutor/payouts` | `academy.tutor` | no |

Amounts `int64` minor units (`Earning.AmountMinor`, `Payout.AmountMinor`,
`PayoutRequest.AmountMinor`). `PayoutRail.Payout(ctx, userID, reference, idemKey, amountMinor)`; nil →
`stubPayoutRail`. `KYCChecker.Tier(ctx,userID)`; nil → `stubKYCChecker` (tier 1). `MinVerifyTier = 1`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Payout FSM legal/illegal | unit/fsm | `tutor_test.go::TestCanPayout_Allowed`, `TestCanPayout_Illegal` | AUTOMATED |
| Verify KYC tier gate | unit/sec | `tutor_test.go::TestVerifyTutor_KYCGate` | AUTOMATED |
| Verify fail-closed on KYC error | unit/sec | `tutor_test.go::TestVerifyTutor_KYCErrorFailsClosed` | AUTOMATED |
| Payout idempotent single rail call | unit/inv | `tutor_test.go::TestRequestPayout_Idempotent_SingleRailCall` | AUTOMATED |
| Payout insufficient balance | unit/inv | `tutor_test.go::TestRequestPayout_InsufficientBalance` | AUTOMATED |
| Payout guards (key/amount) | unit/inv | `tutor_test.go::TestRequestPayout_Guards` | AUTOMATED |
| Payout rail error → failed | unit/fsm | `tutor_test.go::TestRequestPayout_RailError_MarksFailed` | AUTOMATED |
| Balance derived from pending sum | unit/inv | `tutor_test.go::TestEarningsBalance_DerivedFromPendingSum` | AUTOMATED |
| Paid payout flips covered earnings | unit | `tutor_test.go::TestRequestPayout_FlipsCoveredEarnings` | AUTOMATED |
| Onboarding idempotent on user | unit | `tutor_test.go::TestOnboardTutor_IdempotentOnUser` | AUTOMATED |
| Stub rails | unit | `tutor_test.go::TestStubRails` | AUTOMATED |
| Payout against real rail + audit | integration | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `TUTOR-INT-001` | Onboard is idempotent per user | P1 | authed user | `POST /tutor/onboard` twice | — | Same tutor returned; no duplicate |
| `TUTOR-INT-002` | Request payout debits once | P0 | tutor with pending earnings ≥ amount | `POST /tutor/payouts {amountMinor}` + key | key ≥8 | One rail `Payout`; payout `requested→paid`; covered earnings flipped to paid |
| `TUTOR-INT-003` | Verify tutor with tier ≥ 1 | P1 | tutor pending; KYC tier 1; holder | `POST /tutor/:id/verify` | tier 1 | Status `verified` |
| `TUTOR-VAL-001` | Payout missing idempotency key | P0 | tutor with earnings | `POST /tutor/payouts` no key | — | `ErrIdempotencyRequired` → 400 |
| `TUTOR-VAL-002` | Payout zero/negative amount | P0 | tutor | `POST /tutor/payouts {amountMinor:0}` / negative | invalid | `ErrInvalidAmount`; no insert, no rail call |
| `TUTOR-INV-001` | Payout insufficient balance | P0 | pending sum < amount | `POST /tutor/payouts` over balance | over | `ErrInsufficientBalance`; no insert, no rail call (MONEY-INV-005) |
| `TUTOR-INV-002` | Payout idempotent replay | P0 | payout done | Re-POST same key | same key | One insert, one rail call, same payout (MONEY-INV-006) |
| `TUTOR-INV-003` | Concurrent same-key payout → one | P0 | pending earnings | N=10 concurrent, one key | N=10 | Exactly one payout (MONEY-INV-007) |
| `TUTOR-INV-004` | Rail error marks failed, balance intact | P1 | rail errors | `POST /tutor/payouts` | rail error | Payout `requested→failed`; pending balance unchanged |
| `TUTOR-AUTHZ-001` | Owner-scope on assignments/earnings (IDOR) | P0 | tutor A has data | tutor B lists assignments/cohorts/submissions | — | B sees only own (resolved via `GetTutorByUser`) |
| `TUTOR-AUTHZ-002` | Admin verify denied without permission | P0 | caller lacks `academy.tutor` | `POST /tutor/:id/verify` | — | 403 `forbidden` |
| `TUTOR-SEC-001` | Verify tier 0 rejected fail-closed | P0 | tutor; KYC tier 0 | `POST /tutor/:id/verify` | tier 0 | `ErrKYCNotMet`; `kyc_state=rejected`; not verified (KYC-SEC-001) |
| `TUTOR-SEC-002` | Verify fail-closed on KYC lookup error | P0 | KYC read errors | `POST /tutor/:id/verify` | error | `ErrKYCNotMet`; not verified (never allow-on-error) |
| `TUTOR-SEC-003` | Flag-off route inaccessible | P0 | `FEATURE_ACADEMY_TUTOR_ENABLED` off | Call any tutor endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Payout** (`statemachine.go`, `canPayout`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| requested | rail success | paid (terminal) | rail Payout; covered earnings → paid | `TUTOR-FSM-001` |
| requested | rail error | failed (terminal) | pending balance intact | `TUTOR-FSM-002` |

Self-loops illegal (replay handled by idempotency, not the FSM). Tutor status
(pending|verified|suspended), grades, and earning states are const-tracked, not guarded tables;
onboarding is idempotent-on-user rather than an FSM.

## 6. Security & abuse cases

- **KYC gate fail-closed:** verify requires tier ≥ 1; any error or sub-tier → `ErrKYCNotMet`,
  records rejected (`TUTOR-SEC-001/002`; see `kyc-and-tiers.md`).
- **Derived balance:** payable balance = SUM(pending earnings); never a shadow column (I3). Overdraw
  rejected before any rail call (`TUTOR-INV-001`).
- **Idempotency-Key** mandatory + unique-key backstop for concurrent double-payout.
- **IDOR/owner-scope:** assignments/cohorts/submissions/earnings resolved via the caller's tutor id.
- **Amount ≥ 1** enforced (`TUTOR-VAL-002`); client cannot request negative/zero.

## 7. Automated specs to add

- `tutor/live_db_payout_test.go` — `RequestPayout` against real rail: single call, replay no-op,
  concurrent same-key single payout, rail error → failed, audit emitted. TODO.
- `tutor/authz_scope_test.go` — admin verify/suspend denied without `academy.tutor`; owner-scope on
  member reads. TODO.

## 8. Coverage target & exit criteria

Pure FSM + KYC gate + payout-idempotency + derived-balance logic covered by `tutor_test.go`. Exit:
payout single-effect under replay/concurrency, overdraw + rail-error paths proven; KYC verify
fail-closed; owner-scope/IDOR green; admin authz green; flag-off inaccessible.
