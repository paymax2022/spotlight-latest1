# Module: Doctor (Clinician Portal)

**Risk tier:** 1 (earnings/payout money-path 0; PII 0) · **Money-path:** yes (consult earnings, payouts) · **Feature flag:** `FEATURE_DOCTOR_ENABLED` (+ `FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED`)
**Code:** `backend/internal/doctor/` (handler_account/clinical/ai/ops/mdcn_review/vet + repository_* + service_*; `handler_test.go`, `service_test.go`, `service_integration_test.go`, `service_mdcn_review_test.go`) · mounted `/api/v1/doctor` (`finance_routes.go:1967 if cfg.FeatureDoctorEnabled`); MDCN admin `/api/health/doctor/admin/verification` (`health_doctor_mdcn_routes.go`)
**Slug:** `DOCTOR`

## 1. Overview & scope

The clinician-side portal: account/profile/schedule, clinical consult tooling, AI assist,
ops (calls/chat), the **MDCN license verification** review flow (Mode-B assisted), and a vet
sub-portal. Money-path: consult earnings accrual and **payout requests** (`payout.requested`,
ledger-backed, Idempotency-Key). Two P0 spines: (a) **object-level access** — a clinician may
only touch their own patients/appointments/earnings; (b) **license verification** — an
unverified/expired-license doctor must not practice or be paid. Cross-cutting: money invariants,
authentication, RBAC (MDCN reviewer actions gated + audited).

## 2. Services / endpoints in scope (grounded)

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Profile / settings | `GET /api/v1/doctor/profile`, `/settings` | doctor (token) | no |
| Appointments | `GET /appointments`, `POST /appointments/:appointmentId/status` | assigned doctor | no |
| Earnings | `GET /earnings` | owner doctor | read (kobo) |
| Request payout | `POST /api/v1/doctor/payouts` | owner doctor, Idempotency-Key | **yes** |
| Verification submit | `POST /verification` | doctor | no |
| MDCN doc access | (admin) verification console | `doctor.mdcn.document.accessed` (audited) | no |
| MDCN decision | (admin) approve/reject licence | `doctor.mdcn.verification.decided` (audited) | no |
| Clinical / AI / ops | consult notes, AI summaries, call/chat signalling | assigned doctor | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Handler routing / status codes | unit | `internal/doctor/handler_test.go` | AUTOMATED |
| Service logic | unit | `internal/doctor/service_test.go` | AUTOMATED |
| Service + DB integration | int | `internal/doctor/service_integration_test.go` | AUTOMATED |
| MDCN review decision + audit | unit | `internal/doctor/service_mdcn_review_test.go` | AUTOMATED |
| Payout idempotency + ledger | int | — (covered indirectly) | PARTIAL |
| Object-level patient access (IDOR) | int/e2e | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| DOCTOR-INT-001 | Load own profile/earnings | P1 | `qa-doctor`, flag on | `GET /profile`, `/earnings` | — | Own data only |
| DOCTOR-AUTHZ-001 | Cannot view another doctor's earnings | P0 | doctor A + B | B calls A's earnings context | A id | 403/own-scope only |
| DOCTOR-AUTHZ-002 | Appointment status only by assigned clinician | P0 | appointment assigned to A | B `POST /appointments/:id/status` | B token | 403 |
| DOCTOR-AUTHZ-003 | Patient record object-level | P0 | A treats patient P | B accesses P's consult/record | — | Denied (IDOR); see `health.md` HEALTH-AUTHZ-001 |
| DOCTOR-INV-001 | Payout idempotent | P0 | doctor with balance | `POST /payouts` twice, same Idempotency-Key | same key | Single payout; balanced ledger; `payout.requested` once |
| DOCTOR-INV-002 | Payout ≤ available earnings | P0 | balance B | Request payout > B | over | Rejected; no debit |
| DOCTOR-INV-003 | Missing Idempotency-Key on payout | P1 | — | `POST /payouts` no key | — | Rejected (`../cross-cutting/money-invariants.md` I10) |
| DOCTOR-FSM-001 | MDCN verification lifecycle | P0 | submitted licence | reviewer approve / reject / needs-info | — | Only legal transitions; approve grants practice eligibility; reject grants nothing |
| DOCTOR-SEC-001 | Unverified doctor cannot be paid/practice | P0 | doctor not verified | Attempt consult/payout | — | Blocked until verified |
| DOCTOR-SEC-002 | MDCN doc access audited | P0 | reviewer opens a licence doc | Access document | — | `doctor.mdcn.document.accessed` audit event written with reviewer identity |
| DOCTOR-AUTHZ-004 | MDCN decision RBAC-gated | P0 | non-reviewer admin | Attempt approve/reject | — | 403; only permitted reviewer decides |
| DOCTOR-INT-002 | Appointment status transitions | P1 | active appointment | Advance status legally then illegally | — | Legal advances succeed; illegal rejected |
| DOCTOR-INT-003 | AI assist safe output | P2 | consult context | Request AI note/summary | — | Assistive only; no autonomous prescribing/definitive diagnosis surfaced as final |
| DOCTOR-SEC-003 | Flag-off inaccessible | P0 | `FEATURE_DOCTOR_ENABLED` off | Call `/api/v1/doctor/*` | — | Not mounted / 404 (FLAG-SEC-001) |

## 5. State-machine transitions

**MDCN verification** (`service_mdcn_review.go`): submitted → under_review → approved | rejected |
needs_more_info → (resubmit) → under_review. Approve = practice-eligible + audit; reject = no
grant; re-deciding a decided case is idempotent. **Appointment status** (`handler`/`model`):
scheduled → in_progress → completed (+ cancel/no-show); illegal jumps rejected.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| under_review | approve | approved | practice eligible; audit `verification.decided` | DOCTOR-FSM-001 |
| under_review | reject | rejected | no grant; audit | DOCTOR-FSM-002 |
| needs_more_info | resubmit | under_review | new docs | DOCTOR-FSM-003 |
| approved | approve again | approved | idempotent, no double-grant | DOCTOR-FSM-004 |

## 6. Security & abuse cases

Object-level patient/earnings isolation (IDOR); payout idempotency + ceiling; unverified-doctor
lockout; MDCN document-access + decision auditing; reviewer-only decision authz; AI safety
(no autonomous clinical action); flag-off gating.

## 7. Automated specs to add

- `internal/doctor/payout_idempotency_integration_test.go` — replay + ceiling + ledger balance.
- `internal/doctor/patient_access_control_test.go` — IDOR across doctors.
- Extend MDCN test with the unverified-lockout and re-decide-idempotent cases.

## 8. Coverage target & exit criteria

Money + license + PII paths P0 green. Exit: payout idempotent and bounded, unverified doctors
blocked, MDCN access/decisions audited and reviewer-gated, patient data IDOR-proof.
