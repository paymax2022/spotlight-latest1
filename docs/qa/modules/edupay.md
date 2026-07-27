# Module: EduPay (School Fees, Savings Pots, Disbursements)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_EDUPAY_ENABLED` (`FeatureAcademyEduPayEnabled`; runtime override key `academy.edupay` via `academy_feature_flags`, fail-closed to env default)
**Code:** `backend/internal/academy/edupay/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `rails.go`, `edupay_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyEduPay`), collect rail in `academy_rails.go` (`academyLedgerRail.Collect`).
**Slug:** `EDUPAY`

## 1. Overview & scope

School-fee collection and family savings for the academy. A guardian links to a school + student,
pays a fee schedule directly (`pay`/`bnpl`), or saves into a **savings pot** (append-only
contributions; balance is a derived SUM) and later pays a fee from the pot. Admins create
schools/fee-schedules, reconcile disbursements, and award sponsor-funded scholarships. Every money
move rides the Paymax ledger through injected rails — `CollectRail.Collect` (guardian wallet →
ledger), `DisburseRail.Disburse` (school VA payout), `BNPLRail.StartPlan` — with **no shadow
ledger**; `runDisbursement` is the shared four-source pipeline (pay / bnpl / pot / scholarship).

This is a Tier-0 money module: `../cross-cutting/money-invariants.md` (I1–I12) applies to every
`pay`, `pots/:id/fund`, `pots/:id/pay`, admin `reconcile`, and `scholarships/award`. Also:
`../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md` (admin group
`academy.edupay`), `../cross-cutting/webhooks-and-providers.md` (disburse/reconcile settlement),
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy/edupay`; admin base `/api/academy/admin/edupay/admin` (group
guarded `RequirePermission("academy.edupay")`).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List schools / fee-schedules | `GET /schools`, `GET /fee-schedules` | auth | no |
| Link school+student | `POST /link` | auth; owner | no |
| Owner dashboard | `GET /me` | auth; owner | no |
| Pay fees | `POST /pay` | auth; owner + `Idempotency-Key` | **yes** |
| List / create pot | `GET /pots`, `POST /pots` | auth; owner-scoped | no |
| Fund pot | `POST /pots/:id/fund` | auth; owner + `Idempotency-Key` | **yes** |
| Pay fee from pot | `POST /pots/:id/pay` | auth; owner + `Idempotency-Key` | **yes** (draws pot) |
| Admin schools / fee-schedules | `GET/POST /admin/schools`, `GET/POST /admin/fee-schedules` | `academy.edupay` | no |
| Admin disbursements list | `GET /admin/disbursements` | `academy.edupay` | no |
| Reconcile disbursement | `POST /admin/disbursements/:id/reconcile` | `academy.edupay` + `Idempotency-Key` | **yes** (state + audit) |
| Admin pots | `GET /admin/pots` | `academy.edupay` | no |
| Scholarships list/create | `GET/POST /admin/scholarships` | `academy.edupay` | no |
| Award scholarship | `POST /admin/scholarships/award` | `academy.edupay` + `Idempotency-Key` | **yes** |

Amounts `int64` minor units (`AmountMinor`, `TargetMinor`, `BudgetMinor`, `AwardedMinor`,
`SavedMinor`). Idempotency scopes: `edupay.pay`, `edupay.pot_fund`, `edupay.pot_pay`,
`edupay.reconcile`, `edupay.scholarship_award`. `Source` ∈ {`pay`,`bnpl`}.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Disbursement FSM legal transitions | unit/fsm | `edupay_test.go::TestCanDisb_AllowedTransitions` | AUTOMATED |
| Disbursement FSM illegal transitions | unit/fsm | `edupay_test.go::TestCanDisb_IllegalTransitions` | AUTOMATED |
| Pay = single collect + single disburse | unit/inv | `edupay_test.go::TestPayFees_RailIdempotency_SingleCollectSingleDisburse` | AUTOMATED |
| Idempotency request-hash determinism | unit/inv | `edupay_test.go::TestRequestHash_Deterministic` | AUTOMATED |
| Pot balance derived from append-only contributions | unit/inv | `edupay_test.go::TestPotBalance_DerivedFromAppendOnlyContributions` | AUTOMATED |
| Pot insufficient balance rejected | unit | `edupay_test.go::TestPayFromPot_InsufficientBalance_Rejected` | AUTOMATED |
| Reconcile transition | unit/fsm | `edupay_test.go::TestReconcile_TransitionDisbursedToReconciled` | AUTOMATED |
| Scholarship award idempotency + budget exhaustion | unit/inv | `edupay_test.go::TestScholarshipAward_RailIdempotency` | AUTOMATED |
| BNPL source routes to BNPLRail | unit | `edupay_test.go::TestPayFees_BNPLSource_UsesBNPLRail` | AUTOMATED |
| Stub rail idempotent refs | unit | `edupay_test.go::TestStubRails_IdempotentRefs` | AUTOMATED |
| Full pay against real ledger + audit | integration | — | TODO |
| Admin reconcile/award authz | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `EDUPAY-INT-001` | Pay fees collects + disburses once | P0 | active school w/ `VirtualAccountRef`, fee schedule `50000` | `POST /pay {feeScheduleId, source:"pay"}` + key | key ≥8 | One `Collect` (guardian→ledger) + one `Disburse` (→school VA); disbursement FSM to `disbursed` |
| `EDUPAY-INT-002` | Pay amount locked from schedule | P0 | fee schedule `50000` | `POST /pay` with body amount `1` | tampered | Amount taken from schedule (`50000`), client value ignored |
| `EDUPAY-INT-003` | Fund pot appends contribution | P1 | pot owned by caller | `POST /pots/:id/fund {amountMinor:8000}` + key | — | `Collect` once; `SavedMinor` recomputed as SUM (derived, not a column) |
| `EDUPAY-INT-004` | Pay from pot draws balance | P1 | pot `SavedMinor ≥ fee` | `POST /pots/:id/pay {feeScheduleId}` + key | — | No fresh collect (pre-collected ref `pot-<id>`); disbursement `source="pot"` |
| `EDUPAY-INT-005` | BNPL source uses BNPL rail | P1 | fee schedule | `POST /pay {source:"bnpl"}` + key | — | `BNPLRail.StartPlan` invoked once; `CollectRail` not called |
| `EDUPAY-VAL-001` | Invalid source rejected | P1 | — | `POST /pay {source:"gift"}` | invalid | `ErrInvalidSource` → 400 |
| `EDUPAY-VAL-002` | Pay to school without VA ref rejected | P0 | school missing `VirtualAccountRef` | `POST /pay` | — | `ErrSchoolAccountMissing`; no money moved |
| `EDUPAY-VAL-003` | Link to inactive school rejected | P1 | inactive school | `POST /link` | — | `ErrSchoolInactive` |
| `EDUPAY-VAL-004` | Fund pot with non-positive amount rejected | P1 | pot | `POST /pots/:id/fund {amountMinor:0}` | 0 / negative | 400; nothing collected |
| `EDUPAY-INV-001` | Idempotent pay replay | P0 | paid fee | Re-POST `/pay` same key | same key | Same disbursement; no second collect/disburse (MONEY-INV-006) |
| `EDUPAY-INV-002` | Idempotent fund replay | P0 | funded pot | Re-POST `/fund` same key | same key | Contribution `idempotency_key` UNIQUE → ON CONFLICT no-op; balance unchanged |
| `EDUPAY-INV-003` | Concurrent same-key pay → one | P0 | fee schedule | Fire N=10 concurrent `/pay`, one key | N=10 | Exactly one disbursement (MONEY-INV-007) |
| `EDUPAY-INV-004` | Missing Idempotency-Key rejected | P0 | fee schedule | `POST /pay` no key | — | `ErrIdempotencyRequired` → 400 (MONEY-INV-008) |
| `EDUPAY-INV-005` | Pot insufficient balance rejected | P0 | pot `SavedMinor < fee` | `POST /pots/:id/pay` | under-funded | `ErrInsufficientPot`; no disbursement |
| `EDUPAY-INV-006` | Scholarship budget exhaustion | P0 | scholarship `BudgetMinor` near cap | `POST /admin/scholarships/award` exceeding remaining | over-budget | `ErrScholarshipExhausted`; no award/disbursement |
| `EDUPAY-AUTHZ-001` | Pot IDOR — non-owner read/fund | P0 | pot owned by A | B calls `GET /pots` / `POST /pots/:id/fund` | A's potId | B sees only own pots; cannot fund A's pot |
| `EDUPAY-AUTHZ-002` | Admin route denies non-holder | P0 | caller without `academy.edupay` | `POST /admin/disbursements/:id/reconcile` | — | 403 `forbidden` (RBAC-AUTHZ-001) |
| `EDUPAY-AUTHZ-003` | Reconcile allowed for holder + audit | P0 | `disbursed` disbursement; holder | `POST /admin/.../reconcile` + key | — | State `reconciled`; one audit event |
| `EDUPAY-SEC-001` | Flag-off route inaccessible | P0 | `FEATURE_ACADEMY_EDUPAY_ENABLED` off (and no runtime override) | Call any edupay endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |
| `EDUPAY-SEC-002` | Runtime flag fail-closed on store error | P1 | `academy_feature_flags` read errors | boot / resolve `academy.edupay` | — | Falls back to compile-time env default; never silently enabled |

## 5. State-machine transitions

**Disbursement** (`academy_disbursements.state`, `canDisb` — strictly linear):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| fee_due | begin funding | funding | — | `EDUPAY-FSM-001` |
| funding | collected | collected | `Collect` posted | `EDUPAY-FSM-002` |
| collected | disburse | disbursed | `Disburse` to school VA | `EDUPAY-FSM-003` |
| disbursed | reconcile | reconciled (terminal) | audit | `EDUPAY-FSM-004` |

Illegal transitions asserted rejected (`TestCanDisb_IllegalTransitions`, `TestReconcile_*`):
skips (`funding→disbursed`, `collected→reconciled`), backwards, re-entering `reconciled`, unknown.
Award state (`granted|disbursed|revoked`) is a plain field, not a guarded FSM; pot balance is a
derived SUM, not a state machine.

## 6. Security & abuse cases

- **Amount tampering:** fee amount locked from schedule; client body amount ignored (`EDUPAY-INT-002`).
- **Derived-balance invariant:** `saved_minor` = SUM of append-only `academy_pot_contributions`;
  never a directly-updated column (money-invariants I3). Replay a fund → no-op via UNIQUE key.
- **Per-school scope guards:** `ErrSchoolAccountMissing`, `ErrSchoolInactive`, `ErrFeeScheduleInactive`.
- **Owner scope / IDOR:** member pot reads/writes scoped to token `user_id` (`EDUPAY-AUTHZ-001`).
- **Idempotency-Key** mandatory + per-op scope prevents cross-operation key collision.
- **Scholarship** budget guard + sponsor-funded pre-collected leg (no double funding).
- **Spoofed `user_id`** in body ignored — token identity authoritative.

## 7. Automated specs to add

- `edupay/live_db_pay_test.go` — `PayFees`/`FundPot`/`PayFromPot` against real ledger: balanced
  journal, replay no-op, concurrent same-key single disbursement (I2/I5/I6). TODO.
- `edupay/admin_authz_test.go` — reconcile/award denied without `academy.edupay`, allowed with,
  each emits one audit event. TODO.
- `edupay/scholarship_budget_test.go` — award crossing `BudgetMinor` rejected at the DB seam. TODO.

## 8. Coverage target & exit criteria

Pure-logic (statemachine, request-hash, pot balance, budget) ≥ 85% — largely covered by
`edupay_test.go`. Exit: all P0 (`INT-001/002`, `INV-001..006`, `VAL-002`, `AUTHZ-001..003`,
`SEC-001`) green; single collect+disburse under replay/concurrency; pot balance always derived;
flag-off proven inaccessible; every admin money mutation audited.
