# Module: Academy Fees (EdTech School Fees subtree)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (payment, vault, scholarship) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_FEES_ENABLED` (`FlagFees` = `academy.fees`; whole subtree registered inside `if feesEnabled` via `registerAcademyFees`)
**Code:** `backend/internal/academy/fees/` sub-packages `feeschedule`, `invoice`, `payment` (+`payment/reconcile`), `promotion`, `scholarship`, `hardship`, `session`, `student`, `school`, `vault`, `trustscore`, `competition`, `roles`, `adminapi`, `export`; shared `statemachine/`; composition root + money adapters in `backend/internal/app/academy_routes.go` (`registerAcademyFees`). Tests: `backend/tests/edtechfees/` (live-DB) + per-package `*_test.go`.
**Slug:** `FEES`

## 1. Overview & scope

The EdTech school-fees platform: schools onboard and get verified; sessions/classes and immutable
fee schedules are defined; invoices are issued with **derived** balances; guardians pay via a
Paystack intent confirmed by webhook, or via a segregated savings **vault**, or a **scholarship**
pledge. Money packages (payment, vault, scholarship) ride the Paymax `finance/ledger` only — they
register **only when `ledgerSvc != nil`** (payment also needs a provider); a nil ledger fails closed by
non-registration. Non-money packages cover student records, promotion (two-approval), hardship
(human-approved freeze), competition (money-free leaderboards), trust-score, roles (per-school scoped
RBAC), admin oversight (adminapi), and compliance export. Money adapters land guardian debits on the
global `AccountSettlement` (payment/scholarship) or the segregated `AccountEdtechFeesVault` (vault),
with per-school attribution via reference + invoice→schedule→school chain.

Applicable cross-cutting (do not repeat): `../cross-cutting/money-invariants.md` (I1–I12 on payment/
vault/scholarship), `../cross-cutting/webhooks-and-providers.md` (`feespay:` `charge.success`
confirm-and-record), `../cross-cutting/rbac-and-permissions.md` (per-school `RequireScopedPermission`
scope isolation), `../cross-cutting/authentication.md`, `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`. Invariant tags SF-#, SC-#.

### 2.1 school (`RegisterFeesSchool`)
`POST/GET/PATCH /schools`, `GET /schools/:schoolId`, `GET /schools/:schoolId/export` (member;
service self-authorizes owner); `POST /schools/admin/:schoolId/verify` + `GET /schools/admin`
(`RequirePermission("academy.fees.school.verify")`). Verification tier FSM (SF: verified-only export).

### 2.2 session (`RegisterFeesSession`) — no money
Member `/schools/:schoolId/sessions|classes` CRUD + `POST /sessions/:sessionId/status`. Session FSM
active→closed→archived.

### 2.3 feeschedule (`RegisterFeesFeeSchedule`) — no money, **SF-1/SF-6**
`POST/GET /schools/:schoolId/fee-schedules`, `GET/PATCH /fee-schedules/:id`, `POST /fee-schedules/:id/lock`.
`AmountMinor` kobo > 0. **SF-1:** `ensureMutable` refuses any mutation once `locked` OR referenced by
an invoice (`ErrFeeScheduleImmutable`). **SF-6:** `fee_items` + `installment_policy` set at Create only.

### 2.4 student (`RegisterFeesStudent`) — no money
`POST/GET /schools/:schoolId/students`, `GET /students/:studentId`, guardian link/unlink, bulk import
preview/approve. Admission number unique per school; minor flag defaults true.

### 2.5 invoice (`RegisterFeesInvoice`) — **SF-2 core**
`POST /invoices` (Issue — locks schedule via `feeScheduleLocker.Lock`, fail-closed), `GET /invoices/:id`,
`GET /invoices/:id/payments`, `POST /invoices/:id/payments` (RecordPayment — `Idempotency-Key`
mandatory, posts no ledger entry), `GET /students/:studentId/invoices`. **SF-2:** balance/amount_paid
always DERIVED = `TotalAmountMinor − SUM(succeeded payments)`; never a stored column.

### 2.6 promotion (`RegisterFeesPromotion`) — no money, **SF-3**
`POST /schools/:schoolId/sessions/:sessionId/classes/:classId/scores|compute`, `GET /promotions/:id`,
`POST /promotions/:id/{teacher-approval,admin-approval,apply}` (each
`RequirePermission("academy.fees.promotion.approve")`). **SF-3:** two **distinct** human approvals
required before `apply`; enforced in the FSM (only `promotion_approved → applied`), the service (both
approver columns non-empty AND distinct), and a DB CHECK. Rollover reassigns class + schedule
idempotently.

### 2.7 roles (`RegisterFeesRoles`) — no money, scoped RBAC
`POST/DELETE/GET /schools/:schoolId/staff`, group-gated
`RequireScopedPermission("academy.fees.roles.assign", school, schoolId)`. Scope isolation: a grant in
school A must not authorize school B.

### 2.8 hardship (`RegisterFeesHardship`) — no money, **SF-9**
`POST /hardship`, `GET /hardship/:id` (member); `POST /hardship/admin/:id/{approve,deny}` + `GET
/hardship/admin` (`RequirePermission("academy.fees.hardship.review")`). Only a human approval freezes
an overdue invoice (`overdue → frozen`).

### 2.9 adminapi (`RegisterFeesAdminAPI`) — no money, SC-29…SC-40
Group `/fees/*` cross-school oversight; each route self-gated by a seeded slug: `academy.fees.setup`,
`academy.fees.collections`, `academy.fees.promotion.approve`, `academy.fees.competition.manage`,
`academy.fees.export.run`, `academy.fees.roles.assign`. Two config writes (schedule create/issue,
gov-export opt-in).

### 2.10 export (`RegisterFeesExport`) — no money, **SF-10/SF-11**
Group-gated `academy.fees.export.run`: `POST /export/compliance` (SF-11 — validates every requested
category opted-in, appends immutable log), `GET /export/compliance/:schoolId`, `POST
/export/school-data` (SF-10 — verified/premium school only).

### 2.11 vault (`RegisterFeesVault`, ledger-gated) — **MONEY, SF-5**
`/vaults` create/list/get; `POST /vaults/:id/contribute` (money), `POST /vaults/:id/apply-to-invoice`
(money), `POST /vaults/:id/{withdraw,lock,unlock}`. Contributions DEBIT guardian wallet → segregated
`AccountEdtechFeesVault` (`"edtech_fees_vault"`); `Idempotency-Key` mandatory; `saved_minor` derived.

### 2.12 scholarship (`RegisterFeesScholarship`, ledger-gated) — **MONEY**
`/scholarship/pledges` create/get/awards; `POST /pledges/:id/fund` (funding leg, `Idempotency-Key`),
`POST /pledges/:id/apply` (invoice payment, headroom guard `AppliedMinor + amt ≤ AmountMinor`). States
pledged→funded→applied. Admin slug `academy.fees.scholarship.manage` reserved (no admin surface wired
yet).

### 2.13 trustscore (`RegisterFeesTrustScore`, group-gated `academy.fees.trustscore.view`) — no money
`GET /trust-score/:schoolId` (deterministic score 0–100), `POST /trust-score/:schoolId/override`.

### 2.14 competition (`compHandler.Register`) — **money-free, SF-4/SF-7**
`GET /competitions/:id/leaderboard` (SF-7 minor-safe serialized); admin `POST /competitions`,
`/:id/transition` (`academy.fees.competition.manage`), `/:id/register`
(`academy.fees.competition.register`), `/:id/scores` (`academy.fees.competition.score`). Linear FSM;
scoring-lock from `results_pending`.

### 2.15 payment (`RegisterFeesPayment`, ledger+provider-gated) — **MONEY, T3.x**
`POST /payments/intent` (create intent, `Idempotency-Key`, no move), `POST /payments/installment`
(SF-6 disclosure gate). Reference = `"feespay:" + idempotencyKey`. Webhook `charge.success` routes to
`OnChargeSuccess` (verify fail-closed, amount cross-check, `MoveGuardianToSchool` guardian→settlement,
`RecordPayment` SF-2) — end-to-end idempotent on the shared key. `payment/reconcile` (SF-8) is a
read-only nightly drift detector — never auto-corrects money.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Invoice issue locks schedule + derived balance + idempotent payment (real DB) | int/inv | `tests/edtechfees/invoice_live_db_test.go::TestLiveDB_Invoice_IssueLocksSchedule_PartialThenFull_DerivedBalance_Idempotent`, `..._RequiresIdempotencyKey` | AUTOMATED |
| Scholarship fund idempotent + audited (real DB) | int/inv | `tests/edtechfees/scholarship_live_db_test.go::TestLiveDB_Scholarship_PledgeFund_Idempotent_Audited_ThenApplyDocumentsGap` | AUTOMATED (apply step documents schema gap) |
| Vault SF-5 segregated + idempotent + apply-to-invoice (real DB) | int/inv | `tests/edtechfees/vault_live_db_test.go::TestLiveDB_Vault_Contribute_Idempotent_SegregatedThenApplyToInvoice`, `..._RequiresIdempotencyKey` | AUTOMATED |
| Invoice FSM legal/illegal/terminal/idempotent | unit/fsm | `statemachine/statemachine_test.go::TestInvoice*` | AUTOMATED |
| Vault FSM legal/illegal/terminal/legacy-closed | unit/fsm | `statemachine/statemachine_test.go::TestVault*` | AUTOMATED |
| Promotion SF-3 two-approval, no bypass edge | unit/fsm | `statemachine/statemachine_test.go::TestPromotion*`; `promotion/promotion_test.go::TestPromotion_SF3_*` | AUTOMATED |
| Competition linear FSM + scoring-lock boundary | unit/fsm | `statemachine/statemachine_test.go::TestCompetition*`; `competition/competition_test.go` | AUTOMATED |
| Payment confirm-and-record idempotent, fail-closed, amount-mismatch | unit/inv | `payment/payment_test.go::TestConfirm_*`, `TestCreateIntent_*`, `TestInstallment_*` | AUTOMATED |
| SF-8 reconciliation drift detection | unit | `payment/reconcile/reconcile_test.go::TestSF8_*` | AUTOMATED |
| Invoice SF-1/SF-2 + payment idempotency (unit) | unit/inv | `invoice/invoice_test.go` | AUTOMATED |
| Fee-schedule SF-1/SF-6 immutability | unit | `feeschedule/feeschedule_test.go` | AUTOMATED |
| Scholarship fund/apply idempotency + headroom | unit/inv | `scholarship/scholarship_test.go` | AUTOMATED |
| Vault SF-5 + idempotency + FSM | unit/inv | `vault/vault_test.go` | AUTOMATED |
| Hardship SF-9 human-approved freeze | unit | `hardship/hardship_test.go` | AUTOMATED |
| Roles scope isolation + fail-closed | unit/authz | `roles/roles_test.go::TestScopeIsolation_SchoolAGrantDoesNotLeakToB`, `TestAuthorize_FailClosedOnRBACError` | AUTOMATED |
| Competition SF-7 minor-safe serializer | unit/sec | `competition/competition_test.go::TestSF7_*` | AUTOMATED |
| Trust-score determinism + override | unit | `trustscore/trustscore_test.go` | AUTOMATED |
| Export SF-10/SF-11 opt-in + append-only | unit | `export/export_test.go` | AUTOMATED |
| School verify tier FSM | unit/fsm | `school/school_test.go` | AUTOMATED |
| Session FSM + guarded status | unit/fsm | `session/session_test.go` | AUTOMATED |
| Student admission uniqueness + guardian links | unit | `student/student_test.go` | AUTOMATED |
| Payment webhook signature/replay against ledger | integration | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `FEES-INT-001` | Issue invoice derives amount + locks schedule | P0 | fee schedule `AmountMinor=50000` | `POST /invoices` | — | Invoice `issued`; balance `50000` derived; schedule `locked=true` (SF-1) |
| `FEES-INT-002` | Payment intent then webhook confirm | P0 | issued invoice; provider sandbox | `POST /payments/intent` + key, then POST signed `charge.success` (ref `feespay:<key>`) | sandbox | One `MoveGuardianToSchool` (guardian→settlement) + one invoice payment (SF-2); invoice → partially_paid/paid |
| `FEES-INT-003` | Vault contribute hits segregated account | P0 | vault owned by guardian, wallet funded | `POST /vaults/:id/contribute {amountMinor}` + key | — | Debit guardian → `edtech_fees_vault`; `saved_minor` derived; auto reach_target at goal |
| `FEES-INT-004` | Vault apply-to-invoice | P1 | vault `target_reached`; issued invoice | `POST /vaults/:id/apply-to-invoice` + key | — | Records SF-2 invoice payment + one balanced segregated→settlement transfer; vault → applied_to_invoice |
| `FEES-INT-005` | Scholarship fund then apply | P1 | pledge; sponsor wallet funded; issued invoice | `POST /pledges/:id/fund` + key, then `/apply` + key | — | Funding leg once; award applied via SF-2 payment; state pledged→funded→applied |
| `FEES-INT-006` | Promotion two-approval then apply | P0 | promotion computed | teacher-approval, admin-approval (distinct users), apply | 2 approvers | Applied only after both distinct approvals; rollover reassigns class + schedule idempotently |
| `FEES-INT-007` | Hardship freeze on overdue invoice | P1 | overdue invoice; reviewer holds slug | submit hardship, then admin approve | — | Invoice `overdue→frozen`; submit alone changed nothing (SF-9) |
| `FEES-VAL-001` | Mutate locked/referenced fee schedule | P0 | locked or invoice-referenced schedule | `PATCH /fee-schedules/:id` amount | — | `ErrFeeScheduleImmutable` (SF-1); no change |
| `FEES-VAL-002` | RecordPayment without idempotency key | P0 | invoice | `POST /invoices/:id/payments` no key | — | `ErrIdempotencyRequired` → 400 |
| `FEES-VAL-003` | Export category not opted-in | P1 | school without category opt-in | `POST /export/compliance` for that category | — | `ErrCategoryNotOptedIn`; nothing written (fail-closed, SF-11) |
| `FEES-VAL-004` | School-data export requires verified tier | P1 | unverified school | `POST /export/school-data` | — | `ErrSchoolNotVerified` (SF-10) |
| `FEES-INV-001` | Payment confirm idempotent (webhook replay) | P0 | confirmed charge | redeliver identical `charge.success` | same ref | No second ledger move / invoice payment (MONEY-INV-006; WH-SEC-004) |
| `FEES-INV-002` | Vault contribute replay no-op | P0 | contributed | replay `/contribute` same key | same key | Contribution unique key → no-op; balance unchanged |
| `FEES-INV-003` | Scholarship over-headroom rejected | P0 | funded pledge near cap | `/apply` exceeding `AmountMinor` | over | `ErrPledgeExhausted`; no payment/award |
| `FEES-INV-004` | Concurrent same-key payment confirm → one | P0 | intent created | fire N=10 concurrent confirms, one ref | N=10 | Exactly one move + one payment (MONEY-INV-007) |
| `FEES-INV-005` | Invoice balance always derived | P0 | invoice with payments | read invoice | — | balance = total − SUM(succeeded); no cached column (SF-2 / MONEY-INV-004) |
| `FEES-SEC-001` | Payment webhook forged signature rejected | P0 | provider secret set | POST `charge.success` bad HMAC | forged | Rejected; no ledger effect (WH-SEC-002) |
| `FEES-SEC-002` | Payment amount tamper rejected | P0 | intent amount `50000` | confirm with mismatched gateway amount | tampered | `ErrAmountMismatch`; aborts; nothing recorded |
| `FEES-SEC-003` | Confirm fail-closed on unsuccessful charge | P0 | intent | confirm with unverifiable/unsuccessful charge | — | `ErrChargeNotSuccessful`; no move |
| `FEES-AUTHZ-001` | Scoped roles grant isolated per school | P0 | staff granted `academy.fees.roles.assign` in school A | act on A (allow), B (deny) | scope A, B | A → 200; B → 403 (RBAC-AUTHZ-005/006) |
| `FEES-AUTHZ-002` | School verify denied without slug | P0 | caller lacks `academy.fees.school.verify` | `POST /schools/admin/:schoolId/verify` | — | 403 `forbidden` |
| `FEES-AUTHZ-003` | Promotion approval denied without slug | P0 | caller lacks `academy.fees.promotion.approve` | `POST /promotions/:id/admin-approval` | — | 403 |
| `FEES-SEC-004` | SF-7 minor row stripped without consent | P1 | minor on leaderboard, no consent | `GET /competitions/:id/leaderboard` | — | Minor identity stripped; nil/error checker fails closed (strips) |
| `FEES-SEC-005` | Promotion single-approver blocked | P0 | same user attempts both approvals | teacher + admin approval as one user | same actor | `ErrApproversMustDiffer`; not applied (SF-3) |
| `FEES-SEC-006` | SF-8 reconciliation flags missing ledger entry | P1 | settled payment lacking ledger pair | run nightly reconcile | drift | `missing_ledger_entry` drift + `[SF-8 DRIFT]` alert; no auto-correction |
| `FEES-SEC-007` | Fees flag-off subtree inaccessible | P0 | `FEATURE_ACADEMY_FEES_ENABLED` off | Call any fees endpoint | — | Routes not mounted / 404 — never 500 (FLAG-SEC-001) |
| `FEES-SEC-008` | Money surface not registered without ledger | P0 | `ledgerSvc == nil` (or provider nil for payment) | Call `/vaults/:id/contribute`, `/payments/intent` | — | Route absent (fail-closed by non-registration — no silent money drop) |

## 5. State-machine transitions

**Invoice** (`statemachine/invoice.go`): states draft, issued, partially_paid, paid, overdue, frozen,
waived, written_off; terminal paid/waived/written_off. `draft→issued`; `issued→partially_paid|paid|
overdue`; `partially_paid→partially_paid(self)|paid|overdue`; `overdue→partially_paid|paid|frozen`;
`frozen→waived|written_off`; fan-in any-non-terminal→waived|written_off. `FEES-FSM-001`.

**Promotion** (`statemachine/promotion.go` — strictly forward): `session_active → results_finalized →
promotion_computed → promotion_reviewed → promotion_approved → applied`. **The only predecessor of
`applied` is `promotion_approved`** (SF-3 — no computed→applied / reviewed→applied bypass edge). Out-of-
order → `ErrApprovalRequired`. `FEES-FSM-002`.

**Vault** (`statemachine/vault.go`): `active → target_reached|withdrawn|locked`; `target_reached →
applied_to_invoice|withdrawn`; `locked → active`; terminal applied_to_invoice/withdrawn (legacy
`closed` tolerated). `FEES-FSM-003`.

**Competition** (`statemachine/competition.go` — linear forward-only): `draft → open_registration →
registration_closed → in_progress → results_pending → completed → archived`. Scoring locked from
`results_pending`. `FEES-FSM-004`.

**School verification** (`school/statemachine.go`): `unverified→pending`; `pending→verified|unverified`;
`verified→premium|pending`; `premium→verified`. No forward skip (unverified→verified illegal).
`FEES-FSM-005`.

**Session** (`session/statemachine.go`): `active→closed|archived`; `closed→archived`; archived terminal.
`FEES-FSM-006`.

Illegal transitions, terminal re-entry, and idempotent self-loops are asserted rejected/no-op across
`statemachine/statemachine_test.go` and per-package tests. Shared sentinels: `ErrIllegalTransition`,
`ErrTerminal`, `ErrApprovalRequired` (SF-3), `ErrAlreadyInState` (idempotent no-op).

## 6. Security & abuse cases

- **Webhook trust:** `feespay:` `charge.success` must verify HMAC, cross-check amount, and be
  idempotent on the shared key (`FEES-SEC-001/002/003`, `FEES-INV-001`; see `webhooks-and-providers.md`).
- **SF-1 immutability / SF-2 derived balance / SF-3 two-approval / SF-5 segregated vault** are release
  blockers — never a raw balance write, never a bypass edge (`FEES-VAL-001`, `FEES-INV-005`,
  `FEES-SEC-005`, `FEES-INT-003`).
- **Scoped RBAC:** `academy.fees.roles.assign` confined to its school scope — re-run RBAC-AUTHZ-005/006
  (`FEES-AUTHZ-001`); scope comes from the path param, not the body.
- **SF-7 minor safety** fail-closed (`FEES-SEC-004`); **SF-9** freeze requires a human approval;
  **SF-8** reconciliation detects drift but never auto-corrects (`FEES-SEC-006`).
- **Fail-closed registration:** money surfaces absent when the ledger/provider is nil (`FEES-SEC-008`).

## 7. Automated specs to add

- `tests/edtechfees/payment_webhook_live_db_test.go` — signed `charge.success` end-to-end: valid
  applies once, forged/tampered rejected, replay no-op, amount-mismatch aborts (WH-SEC-001..004). TODO.
- `tests/edtechfees/promotion_rollover_live_db_test.go` — two distinct approvals then apply; rollover
  reassigns class + schedule idempotently against real DB. TODO.
- `fees/roles/authorization_scope_test.go` — table-driven `RequireScopedPermission` grant-in-A /
  deny-in-B (RBAC gap). TODO.
- Resolve the documented scholarship apply schema-integration gap (awards FK + state CHECK) so
  `scholarship_live_db_test.go` exercises apply end-to-end. TODO.

## 8. Coverage target & exit criteria

Pure logic (all `statemachine/`, invoice SF-2, promotion SF-3, vault SF-5, payment confirm, reconcile
SF-8, trust-score, serializer) ≥ 85% — largely covered. Exit: payment confirm-and-record proven
idempotent + signature-verified + amount-checked against the real ledger; SF-1/SF-2/SF-3/SF-5 proven;
scoped-RBAC isolation green; money surfaces fail-closed when ledger absent; fees flag-off inaccessible;
no S1 open on any money leg.
