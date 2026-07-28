# Module: Academy Schools (B2B2C Institutions)

**Risk tier:** 1 &nbsp;·&nbsp; **Money-path:** yes (institution billing rail) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_SCHOOLS_ENABLED` (`FlagSchools` = `academy.schools`; registered only inside `if schoolsEnabled`)
**Code:** `backend/internal/academy/schools/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `rails.go`, `schools_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademySchools`).
**Slug:** `SCHOOLS`

## 1. Overview & scope

B2B2C institution management: institutions, licences (seat pool), class-groups, bulk enrolment, and
**billing** charged via an injected `BillingRail` (stub in dev). Licences follow a guarded lifecycle
(`active → suspended/expired`, `suspended → active/expired`); bulk enrolment is seat-capped under a
`FOR UPDATE` lock; billing `ChargeBilling` requires an `Idempotency-Key` and is idempotent on a local
`open → paid` guard (already-paid = no second rail call). The rail owns value movement; the module
flips local state only. Admin routes are gated by `academy.schools`; member routes are read-only
institution views scoped to the calling admin user.

Applicable cross-cutting: `../cross-cutting/money-invariants.md` (billing charge idempotency/replay),
`../cross-cutting/authentication.md`, `../cross-cutting/rbac-and-permissions.md`,
`../cross-cutting/webhooks-and-providers.md` (billing rail), `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`; admin group `/schools/admin`
guarded `RequirePermission("academy.schools")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| My institutions | `GET /schools/mine` | member (auth) | no |
| Institution overview | `GET /schools/:id/overview` | member | no |
| Admin overview | `GET /schools/admin/overview` | `academy.schools` | no |
| Create / list institutions | `POST/GET /schools/admin/institutions` | `academy.schools` | no |
| Institution overview / class-groups | `GET /schools/admin/institutions/:id/overview`, `/class-groups` | `academy.schools` | no |
| List licences / class-groups / billing | `GET /schools/admin/licences`, `/class-groups`, `/billing` | `academy.schools` | no |
| Create licence | `POST /schools/admin/licences` | `academy.schools` | no (issues seats) |
| Suspend / reactivate / expire licence | `POST /schools/admin/licences/:id/{suspend,reactivate,expire}` | `academy.schools` | no |
| Create class-group | `POST /schools/admin/class-groups` | `academy.schools` | no |
| Bulk enroll / remove enrollment | `POST /schools/admin/enrollments/bulk`, `DELETE /schools/admin/enrollments` | `academy.schools` + per-learner `Idempotency-Key` | no |
| Create billing line | `POST /schools/admin/billing` | `academy.schools` | no |
| Charge billing | `POST /schools/admin/billing/:id/charge` | `academy.schools` + `Idempotency-Key` | **yes** |

Amounts `int64` minor units (`Licence.PriceMinor`, `Billing.AmountMinor`). `BillingRail.Charge(ctx,
institutionRef, reference, idemKey, amountMinor)`; nil → `StubBillingRail`. Enroll state
invited|active|removed; billing state open|invoiced|paid|void.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Licence FSM legal/illegal transitions | unit/fsm | `schools_test.go::TestCanLicence_AllowedTransitions`, `TestCanLicence_IllegalTransitions` | AUTOMATED |
| Licence lifecycle service (suspend/reactivate/expire) | unit | `schools_test.go::TestLicenceLifecycle_Service` | AUTOMATED |
| Bulk enroll seat cap | unit | `schools_test.go::TestBulkEnroll_SeatCapped` | AUTOMATED |
| Bulk enroll idempotent replay | unit/inv | `schools_test.go::TestBulkEnroll_IdempotentReplay` | AUTOMATED |
| Remove enrollment frees seat | unit | `schools_test.go::TestRemoveEnrollment_FreesSeat` | AUTOMATED |
| Billing charge once (replay no-op) | unit/inv | `schools_test.go::TestChargeBilling_Once` | AUTOMATED |
| Billing requires idempotency key | unit/inv | `schools_test.go::TestChargeBilling_RequiresIdemKey` | AUTOMATED |
| Stub rail idempotent ref | unit | `schools_test.go::TestStubBillingRail_IdempotentRef` | AUTOMATED |
| Charge against real rail + audit | integration | — | TODO |
| Admin authz + scope | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SCHOOLS-INT-001` | Create institution + licence | P1 | holder | `POST /schools/admin/institutions`, then `POST /schools/admin/licences` | seats=100 | Institution active; licence `active` with 100 seats |
| `SCHOOLS-INT-002` | Bulk enroll within seats | P1 | licence 3 seats | `POST /schools/admin/enrollments/bulk` 3 learners | 3/3 | 3 seated; `used_seats=3` |
| `SCHOOLS-INT-003` | Bulk enroll over seats capped | P0 | licence 3 seats | bulk 5 learners | 5→3 | 3 seated then `ErrSeatLimitExceeded`; used_seats capped at 3 |
| `SCHOOLS-INT-004` | Remove frees a seat | P1 | full licence | `DELETE /schools/admin/enrollments`, then enroll one more | — | Freed seat re-usable |
| `SCHOOLS-INT-005` | Charge billing once | P0 | billing line `open`, `PriceMinor` set | `POST /schools/admin/billing/:id/charge` + key | key ≥8 | Rail charged once; line `open→paid` |
| `SCHOOLS-VAL-001` | Charge missing idempotency key | P0 | billing line `open` | `POST .../charge` no key | — | `ErrIdempotencyRequired` → 400 |
| `SCHOOLS-VAL-002` | Licence on inactive institution rejected | P1 | inactive institution | `POST /schools/admin/licences` | — | `ErrInstitutionInactive` |
| `SCHOOLS-INV-001` | Charge idempotent replay | P0 | line paid | Re-POST `/charge` same key | same key | No second rail call; line stays `paid` (MONEY-INV-006) |
| `SCHOOLS-INV-002` | Bulk enroll idempotent replay | P0 | batch already enrolled | replay same batch | same keys | 0 new seats; `alreadyEnrolled` reported; no double-seat |
| `SCHOOLS-INV-003` | Concurrent charge → one | P1 | line `open` | N=10 concurrent `/charge`, one key | N=10 | Exactly one rail charge (MONEY-INV-007) |
| `SCHOOLS-AUTHZ-001` | Admin route denied without permission | P0 | caller lacks `academy.schools` | `POST /schools/admin/licences` | — | 403 `forbidden` |
| `SCHOOLS-AUTHZ-002` | Member view scoped to caller | P1 | admin A owns institutions | admin B `GET /schools/mine` | — | B sees only own institutions (no cross-tenant leak) |
| `SCHOOLS-FSM-001` | Illegal licence transition rejected | P1 | licence `expired` | `POST .../reactivate` | — | Rejected `ErrIllegalTransition` (expired terminal); audited |
| `SCHOOLS-SEC-001` | Flag-off route inaccessible | P0 | `FEATURE_ACADEMY_SCHOOLS_ENABLED` off | Call any schools endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Licence** (`statemachine.go`, `canLicence`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| active | suspend | suspended | audited | `SCHOOLS-FSM-002` |
| active | expire | expired (terminal) | audited | `SCHOOLS-FSM-003` |
| suspended | reactivate | active | audited | `SCHOOLS-FSM-004` |
| suspended | expire | expired (terminal) | audited | `SCHOOLS-FSM-005` |

Illegal transitions rejected `ErrIllegalTransition` (double-suspend, reactivate-after-expire, self-loop,
unknown source) — `TestCanLicence_IllegalTransitions`, `TestLicenceLifecycle_Service`. Enrollment
(invited|active|removed) and billing (open|invoiced|paid|void) are const-tracked, not guarded tables.

## 6. Security & abuse cases

- **Idempotency-Key** mandatory on billing charge (`SCHOOLS-VAL-001`) and per-learner on bulk enroll;
  replay is a no-op (`SCHOOLS-INV-001/002`).
- **Seat-cap guard** under `FOR UPDATE` — no overselling seats (`SCHOOLS-INT-003`).
- **Institution-active guard** for licence issue / bulk enroll (`ErrInstitutionInactive`).
- **Cross-tenant scope:** member views scoped to the calling admin (`SCHOOLS-AUTHZ-002`); admin routes
  gated `academy.schools`. No KYC gate here.
- **Amount:** billing amount is server-side (`PriceMinor`/`AmountMinor`), not client-supplied.

## 7. Automated specs to add

- `schools/live_db_billing_test.go` — `ChargeBilling` against real rail: charge once, replay no-op,
  concurrent same-key single charge, audit emitted. TODO.
- `schools/authz_scope_test.go` — admin routes denied without `academy.schools`; member view isolated
  per admin. TODO.

## 8. Coverage target & exit criteria

Pure FSM + seat-cap + billing-idempotency logic covered by `schools_test.go`. Exit: billing charge
proven single-effect under replay/concurrency + audited; seat cap never oversells; licence FSM
illegal transitions rejected; admin authz + tenant scope green; flag-off inaccessible.
