# Module: Health

**Risk tier:** 1 (money paths 0; PII access 0) · **Money-path:** partial (pharmacy/lab orders) · **Feature flag:** `FEATURE_HEALTH_ENABLED` (+ sub-flags `FEATURE_HEALTH_INTAKE_ENABLED`, `_TRIAGE_ENABLED`, `_LAB_ENABLED`, `_PHARMACY_ENABLED`, `_VET_ENABLED`, `_TRIAGE_WHATSAPP_ENABLED`)
**Code:** `backend/internal/health/` (sub-pkgs: consult, preconsult, triage, symptomsearch, intake, scheduling, records, rx, lab, pharmacy, providers, credential, consent, vet) · route wiring `backend/internal/app/health_routes.go`, `health_lab_routes.go`, `health_pharmacy_routes.go`
**Slug:** `HEALTH`

## 1. Overview & scope

The consumer healthcare suite: symptom triage → pre-consult intake → consult → prescriptions
(rx), plus lab orders (with chain-of-custody) and pharmacy orders (with dispense audit), health
records, consent, and vet. **Clinical records are PII — object-level access control is P0.**
Money enters via lab/pharmacy order payment and provider payouts; those inherit
`../cross-cutting/money-invariants.md`. PII/consent, red-flag escalation, and provider license
verification (MDCN/PCN/MLSCN/VCN — see `doctor.md`) are the security spine. Auth per
`../cross-cutting/authentication.md`; admin/clinician actions are RBAC-gated
(`../cross-cutting/rbac-and-permissions.md`).

## 2. Services / endpoints in scope (selected — grounded in route files)

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Book appointment | `POST /api/finance/health/appointments` | member (token) | no |
| List/get appointment | `GET /appointments`, `/appointments/:appointmentId` | owner | no |
| Consult lobby | `GET /consults/:id/lobby` | consult participant | no |
| Get/write records | `GET /records/:subjectId`, `/records/:appointmentId`, `DELETE /records/:subjectId` | **object-level (subject/clinician only)** | no |
| Record access log | `GET /records/:subjectId/access-log`, `/access-log` | subject/admin | no |
| Consent | `GET /consent`, `/consent-versions` | member | no |
| Intake schema | `GET /intake/:schemaId` | member | no |
| Red-flag queue | `GET /red-flag-queue` | clinician/admin (RBAC) | no |
| Provider applications | `GET /providers/applications(/:id)` | admin (RBAC) | no |
| Lab: order/get/results | `POST /lab/orders`, `GET /orders/:id`, `POST /orders/:id/results` | member/lab-role | **yes (order pay)** |
| Lab custody chain | `POST /samples/:id/accession`/`/handover`/`/breach`, `GET /orders/:id/custody` | lab-role | no |
| Pharmacy: order/confirm/dispense | `POST /pharmacy/orders`, `/orders/:id/confirm`, `/dispense`, `/dispatch`, `/complete` | member/pharmacy-role | **yes (order pay)** |
| Pharmacy rx verify | `POST /prescriptions/:id/verify` | pharmacy-role | no |
| Product recall | `POST /products/:id/recall` | pharmacy-role/admin | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Symptom-search rules/scoring | unit | `internal/health/symptomsearch/{rules,service,handler}_test.go` | AUTOMATED |
| Consult access gate | unit | `internal/health/consult/gate_test.go` | AUTOMATED |
| Pre-consult schema / red-flag / summary | unit | `internal/health/preconsult/{schema,redflag,summary}_test.go` | AUTOMATED |
| Pharmacy quantity gate / discovery / service | unit | `internal/health/pharmacy/{quantity_gate,discovery,service}_test.go` | AUTOMATED |
| Triage core / care / governance | unit | `internal/health/triage/**/*_test.go` | AUTOMATED |
| Credential service | unit | `internal/health/credential/service_test.go` | AUTOMATED |
| Lab/pharmacy order pay + payout integration | int | — | TODO |
| Records object-level access (IDOR) | int/e2e | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| HEALTH-INT-001 | Book → consult lobby | P1 | `qa-user-a`, flag on | Book appointment → open lobby | — | Appointment created; lobby reachable only by participants |
| HEALTH-AUTHZ-001 | Records object-level (IDOR) | P0 | A has records; `qa-user-b` | B `GET /records/<A-subjectId>` | A's subjectId | 403/404 — B cannot read A's PII |
| HEALTH-AUTHZ-002 | Record delete restricted | P0 | A subject | B attempts `DELETE /records/:subjectId` for A | — | Denied; deletion only by authorized subject/role; audited |
| HEALTH-AUTHZ-003 | Access-log visibility | P1 | A subject | A reads own `/records/:subjectId/access-log` | — | Sees who accessed; B cannot read A's log |
| HEALTH-SEC-001 | Consent required before clinical action | P0 | no consent recorded | Attempt consult/record write without current consent version | — | Blocked until consent captured; version tracked |
| HEALTH-INT-002 | Triage red-flag escalation | P0 | red-flag symptom input | Submit triage answers hitting a red-flag rule | red-flag payload | Escalated to `red-flag-queue`; safe-completion messaging (never diagnostic certainty) |
| HEALTH-CON-001 | Intake schema validation | P1 | schema id | Submit intake failing schema | invalid field | 400 field-level errors; valid submission accepted |
| HEALTH-INT-003 | Lab order → results | P1 | funded member | `POST /lab/orders` → pay → `POST /orders/:id/results` | kobo | Order paid once (idempotent); results attached; custody chain intact |
| HEALTH-FSM-001 | Lab custody chain integrity | P0 | ordered sample | accession → handover → (breach) | — | Only legal custody transitions; a `breach` flags the sample; illegal jumps rejected |
| HEALTH-INT-004 | Pharmacy order lifecycle | P1 | funded member, valid rx | order → confirm → dispense → dispatch → complete | kobo | Payment once; dispense gated on rx verify; status transitions valid |
| HEALTH-SEC-002 | Pharmacy dispense requires rx verify | P0 | unverified rx | Attempt dispense before `prescriptions/:id/verify` | — | Blocked; controlled-substance quantity gate enforced |
| HEALTH-INT-005 | Product recall propagates | P2 | dispatched product | `POST /products/:id/recall` | — | Affected orders flagged; audit written |
| HEALTH-AUTHZ-004 | Red-flag queue role-gated | P0 | `qa-user-a` | Non-clinician `GET /red-flag-queue` | — | 403 |
| HEALTH-MON-001 | Money invariants on order pay | P0 | funded | Pay a lab/pharmacy order twice (same Idempotency-Key) | same key | Single debit; balanced ledger (`../cross-cutting/money-invariants.md`) |
| HEALTH-SEC-003 | Flag-off inaccessible | P0 | `FEATURE_HEALTH_ENABLED` off | Call any health route | — | Not mounted / 404 (`../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001) |
| HEALTH-SEC-004 | Sub-flag gating | P1 | `_LAB_ENABLED` off but health on | Call `/lab/orders` | — | Lab routes inaccessible; core health still works |

## 5. State-machine transitions

**Lab order / sample custody** (`lab/model.go`): ordered → scheduled → collected → accessioned →
(handover) → resulted; `breach` from any pre-result state → flagged. Illegal: result before
accession → rejected. **Pharmacy order:** created → confirmed → dispensed → dispatched →
completed (+ cancel window); dispense requires verified rx. Illegal transitions rejected;
terminal states idempotent.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| ordered | accession | accessioned | custody row appended | HEALTH-FSM-001 |
| accessioned | result | resulted | results attached | HEALTH-FSM-002 |
| ordered | result (skip accession) | — | rejected | HEALTH-FSM-003 |
| confirmed | dispense (rx unverified) | — | rejected | HEALTH-SEC-002 |

## 6. Security & abuse cases

Object-level PII isolation on all `records`/`access-log`/`prescriptions` (IDOR); consent-gating;
red-flag safe-completion (no definitive diagnosis); controlled-substance quantity gate;
dispense-after-verify; provider-license verification (see `doctor.md`); flag/sub-flag gating;
audit on record access and money mutations. Money invariants per cross-cutting.

## 7. Automated specs to add

- `internal/health/records/access_control_test.go` — IDOR table (subject/clinician/other).
- Lab + pharmacy order-pay integration test vs ledger (idempotent, tier/KYC where applicable).
- Lab custody FSM test (legal + illegal transitions, breach).
- Consent-gate integration test.

## 8. Coverage target & exit criteria

Pure-logic health funcs ≥ 80%; money + PII paths P0 green. Exit: records IDOR-proof, consent
enforced, red-flag escalation works, order payments idempotent, dispense gated on rx verify,
flags gate access.
