# Module: Telemedicine (doctors, appointments, consult-fee escrow)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes (consult-fee escrow Hold → 85/15 settle → refund) &nbsp;·&nbsp; **Feature flag:** `FEATURE_TELEMEDICINE_ENABLED`
**Code:** `backend/internal/telemedicine/` (`handler.go`, `handler_block13.go`, `service.go`, `service_block13.go`, `model.go`, `model_block13.go`, `model_test.go`, `block13_test.go`, `health_premium_test.go`); wiring in `backend/internal/app/finance_routes.go:1419-1461`
**Slug:** `TELEMEDICINE` (uppercase, used in Case IDs)

## 1. Overview & scope

Telemedicine lets a patient discover doctors, **book a consultation (which escrows the consult
fee)**, and lets the assigned doctor complete it (settling 85% to the doctor, 15% platform),
issue prescriptions, submit SOAP notes, and manage availability. Money moves through
`finance/settlement` (`Escrow` → `Settle` → `Refund`), which itself posts balanced double-entry
ledger legs and is idempotency-keyed. `BookAppointment` **requires** an `Idempotency-Key`
(binding `required`) and passes it to `settlement.Escrow`. A fail-closed **MDCN credential gate**
(`assertDoctorApproved`) blocks any booking of a doctor who is not `doctor_verifications.status=
'approved'` — `is_available` alone must never bypass the licence check.

Two route surfaces exist: legacy `/api/finance/telemedicine/*` (authed via the `finance` group)
and the mobile-facing `/api/v1/telemedicine/*` (`requireUserID()`). SOAP notes, prescriptions, and
visit summaries are **clinical PII** — object-level access control is P0.

Cross-cutting that applies (run these with this module's data): `../cross-cutting/money-invariants.md`
(escrow Hold/Settle/Refund — I1–I9), `../cross-cutting/authentication.md`,
`../cross-cutting/kyc-and-tiers.md` (settlement debit limits), `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Both surfaces share handlers; paths below use `/api/v1/telemedicine` (legacy `/api/finance/telemedicine` mirrors book/complete/cancel/prescription).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List specialties | `GET /specialties` | authed | no |
| List / get doctors | `GET /doctors`, `GET /doctors/:id` | authed | no |
| Doctor availability / reviews | `GET /doctors/:id/availability`, `/reviews` | authed | no |
| Register doctor (v1 / v2) | `POST /doctors`, `POST /doctor/register` | authed (self as doctor) | no |
| **Book appointment (escrow fee)** | `POST /appointments` | authed patient; **Idempotency-Key required**; MDCN gate | **yes (Hold)** |
| List / get my appointments | `GET /appointments`, `GET /appointments/:id` | owner (patient or doctor) | no |
| Visit summary | `GET /appointments/:id/summary` | participant only | no (PII) |
| Confirm / reschedule | `POST /appointments/:id/confirm`, `/reschedule` | participant | no (escrow preserved) |
| **Complete appointment (settle 85/15)** | `POST /appointments/:id/complete` | **assigned doctor only** | **yes (Settle)** |
| **Cancel appointment (refund)** | `POST /appointments/:id/cancel`, `DELETE /appointments/:id` | participant | **yes (Refund)** |
| Add review | `POST /appointments/:id/review` | patient only, completed only | no |
| Issue / get prescription | `POST`/`GET /appointments/:id/prescription` | assigned doctor / participant | no (PII) |
| Doctor dashboard | `GET /doctor/dashboard` | owner doctor | no (revenue projection) |
| Toggle availability | `PATCH /doctor/availability` | owner doctor | no |
| Submit SOAP note | `POST /doctor/notes` | assigned doctor only | no (PII) |
| Upload licence doc | `POST /doctor/licence` | owner doctor | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Appointment status constants + terminal states | unit | `internal/telemedicine/model_test.go` `TestAppointmentStatusConstants`, `TestTerminalAppointmentStates` | AUTOMATED |
| Consult-fee minimum (`min=100`) | contract | `model_test.go` `TestConsultFeeMinimum` | AUTOMATED |
| 85/15 settlement split arithmetic (kobo-exact) | inv | `model_test.go` `TestSettlementSplitForTelemedicine`; `health_premium_test.go` `TestTelemedicineSettlementSplitArithmetic`; `block13_test.go` `TestBlock13SettlementSplit` | AUTOMATED |
| No float leak in settlement arithmetic | inv | `health_premium_test.go` `TestTelemedicineNoFloatLeak` | AUTOMATED |
| Register-doctor-v2 required fields + bad body | contract | `health_premium_test.go` `TestRegisterDoctorV2RequiredFields`, `TestRegisterDoctorV2BadBody` | AUTOMATED |
| SOAP note required fields + bad body | contract | `health_premium_test.go` `TestSOAPNoteRequiredFields`, `TestSubmitSOAPNoteBadBody` | AUTOMATED |
| Book bad body / consult types | contract | `health_premium_test.go` `TestBookAppointmentBadBody`, `TestBookAppointmentConsultationTypes` | AUTOMATED |
| Idempotency-Key header fallback | contract | `health_premium_test.go` `TestIdempotencyKeyHeaderFallback` | AUTOMATED |
| ListSpecialties auth guard | authz | `health_premium_test.go` `TestListSpecialtiesAuthGuard` | AUTOMATED |
| Licence upload bad body / doc types | contract | `health_premium_test.go` `TestUploadLicenceBadBody`, `TestLicenceDocumentTypes` | AUTOMATED |
| Availability synth-slot shape/mix | unit | `block13_test.go` `TestSynthSlots*` | AUTOMATED |
| Review rating bounds + aggregate arithmetic | unit | `block13_test.go` `TestSubmitReview*`, `TestRatingAggregateArithmetic` | AUTOMATED |
| **Escrow Hold on booking (real ledger)** | int/inv | — | TODO |
| **Idempotent booking replay (no double-escrow)** | inv | — | TODO |
| **MDCN credential gate fail-closed** | sec | — | TODO |
| **Settle only by assigned doctor; refund idempotent** | authz/inv | — | TODO |
| Object-level authz on PII (SOAP/rx/summary) | authz | — | TODO |
| Dashboard revenue uses SQL float (`fee_kobo*0.85`) | inv | — | TODO (defect watch) |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `TELEMEDICINE-INT-001` | Book consult escrows the fee | P0 | flag on; MDCN-approved, available doctor D fee 500000 kobo; funded patient P | `POST /appointments {doctor_id:D,scheduled_at,idempotency_key:K}` | fee 500000 kobo | 201; appointment `booked`, `settlement_id` set; escrow Hold of exactly 500000 kobo (balanced ledger, `../cross-cutting/money-invariants.md` I2) |
| `TELEMEDICINE-INV-001` | Booking replay is idempotent | P0 | booked appt exists for key K | repeat `POST /appointments {…idempotency_key:K}` | same K | Same settlement result; escrow entries count unchanged (I5) — no second Hold |
| `TELEMEDICINE-INV-002` | Concurrent same-key booking → one Hold | P0 | funded P | fire N concurrent `POST /appointments` with one K | same K | Exactly one escrow Hold; others no-op (I6) |
| `TELEMEDICINE-VAL-001` | Booking requires Idempotency-Key | P0 | authed P | `POST /appointments {doctor_id:D,scheduled_at}` (no key, no header) | — | 400 (binding `idempotency_key required`) — no escrow |
| `TELEMEDICINE-VAL-002` | Consult fee below minimum rejected | P1 | register doctor | `POST /doctors {…consult_fee_kobo:50}` | 50 kobo | 400 (`min=100`) |
| `TELEMEDICINE-SEC-001` | MDCN gate: cannot book un-approved doctor | P0 | doctor D `is_available=true` but NOT `doctor_verifications='approved'` | `POST /appointments {doctor_id:D,…}` | — | rejected "doctor is not MDCN-approved"; **no escrow** (fail-closed, `service.go:302`) |
| `TELEMEDICINE-SEC-002` | MDCN gate fail-closed on lookup error | P0 | verification table unavailable / partial migration | `POST /appointments` | — | rejected "credential not verified" — never allowed on error |
| `TELEMEDICINE-VAL-003` | Booking a taken slot rejected | P1 | active appt already at doctor D + time T | `POST /appointments {doctor_id:D,scheduled_at:T}` | — | rejected "time slot is no longer available" (`assertSlotFree`); no escrow |
| `TELEMEDICINE-VAL-004` | Booking unavailable doctor rejected | P2 | doctor `is_available=false` | `POST /appointments {doctor_id:D,…}` | — | rejected "doctor is not currently available" |
| `TELEMEDICINE-INT-002` | Complete settles 85/15 kobo-exact | P0 | booked appt A fee 500000, assigned doctor Dr | as Dr: `POST /appointments/A/complete` | 500000 kobo | 200; status `completed`; doctor credited 425000, platform 15000 → sum == 500000 to the kobo (I9); ledger balanced |
| `TELEMEDICINE-AUTHZ-001` | Only assigned doctor can complete | P0 | booked appt A of doctor Dr1 | as Dr2 (other doctor): `POST /appointments/A/complete` | — | rejected "only the assigned doctor can complete" — no settlement |
| `TELEMEDICINE-FSM-001` | Cannot complete a completed/cancelled appt | P1 | appt A already completed | `POST /appointments/A/complete` | — | rejected "not in a completable state" (guard booked/confirmed only) |
| `TELEMEDICINE-INT-003` | Cancel refunds the patient | P0 | booked appt A held fee 500000 | `POST /appointments/A/cancel` | — | 200; status `cancelled`; refund restores patient balance (I7); ledger appends, never mutates history |
| `TELEMEDICINE-INV-003` | Refund is idempotent | P0 | appt A already cancelled/refunded | `POST /appointments/A/cancel` again | — | No double-refund (I8) — refund keyed on settlement id |
| `TELEMEDICINE-FSM-002` | Cannot cancel a completed appt | P1 | appt A completed | `POST /appointments/A/cancel` | — | rejected "cannot cancel a completed appointment" |
| `TELEMEDICINE-AUTHZ-002` | IDOR: patient sees only own appointments | P0 | appt A owned by patient P1 | as P2: `GET /appointments/A`, `GET /appointments` | — | P2 cannot read A (query scoped to patient or assigned doctor); list returns only P2's |
| `TELEMEDICINE-AUTHZ-003` | IDOR: prescription readable only by participant | P0 | rx on appt A (patient P, doctor Dr) | as stranger S: `GET /appointments/A/prescription` | — | rejected "not permitted to view this prescription" (`GetPrescription` object-level) |
| `TELEMEDICINE-AUTHZ-004` | SOAP note writable only by assigned doctor | P0 | appt A of doctor Dr | as Dr2: `POST /doctor/notes {appointment_id:A,…}` | — | rejected "only the assigned doctor can submit notes" (PII) |
| `TELEMEDICINE-AUTHZ-005` | Visit summary participant-only | P1 | appt A | as non-participant: `GET /appointments/A/summary` | — | rejected "not authorised for this appointment" |
| `TELEMEDICINE-FSM-003` | Prescription only for completed appt | P1 | appt A booked (not completed) | as Dr: `POST /appointments/A/prescription {medications:"x"}` | — | rejected "only for completed appointments" |
| `TELEMEDICINE-FSM-004` | Review only patient + completed + once | P1 | appt A completed, patient P | `POST /appointments/A/review {rating:5}` twice; and rating 6 | rating 6 | first 200; second rejected (UNIQUE, immutable); rating 6 → "rating must be between 1 and 5" |
| `TELEMEDICINE-INV-004` | DEFECT: dashboard revenue uses SQL float | P1 | doctor with completed appts | `GET /doctor/dashboard` | — | `weekly_revenue_kobo` computed as `SUM(fee_kobo*0.85)` (float, `service.go:202`). Assert value is still integer-kobo and matches settlement 85% exactly; flag the float arithmetic as a money-hygiene defect (I1). |
| `TELEMEDICINE-INT-004` | Register v2 doctor starts unverified | P2 | authed user | `POST /doctor/register {…mdcn_number:X}` | — | 201; doctor `is_available=false` until MDCN approval (v2); cannot yet take bookings |
| `TELEMEDICINE-SEC-003` | Flag-off: routes not mounted | P0 | `FEATURE_TELEMEDICINE_ENABLED` off | call any telemedicine route | — | not mounted / 404, never 500 — `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |

## 5. State-machine transitions

Appointment lifecycle (`AppointmentStatus`, guards in `service.go` / `service_block13.go`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | BookAppointment | `booked` | **escrow Hold** of consult fee | `TELEMEDICINE-INT-001` |
| `booked` | Confirm (participant) | `confirmed` | none (money unchanged) | — |
| `booked`/`confirmed` | Reschedule (participant) | same status | scheduled_at updated; **escrow preserved** | — |
| `booked`/`confirmed` | Complete (assigned doctor) | `completed` | **settle 85/15** | `TELEMEDICINE-INT-002` |
| `booked`/`confirmed` | Cancel (participant) | `cancelled` | **refund** patient | `TELEMEDICINE-INT-003` |
| `completed` | Complete / Cancel | — (rejected) | terminal; no money moves | `TELEMEDICINE-FSM-001/002` |
| `completed` | Review (patient, once) | (unchanged) | review row + rating projection | `TELEMEDICINE-FSM-004` |

Illegal transitions: completing a non-booked/confirmed appt, cancelling a completed appt,
issuing a prescription before completion, confirming a non-booked appt — all rejected. Refund and
escrow are idempotent by settlement id / idempotency key (re-entering a terminal money state does
not double-move funds).

## 6. Security & abuse cases

- **Money invariants (P0):** run `../cross-cutting/money-invariants.md` I1–I9 against Hold (book),
  Settle (complete), Refund (cancel) — `TELEMEDICINE-INT-001/002/003`, `INV-001/002/003`.
- **Server-side pricing (P0):** the escrow amount is read from `doctors.consult_fee_kobo`, never
  from the client — verify a tampered client fee cannot change the Hold amount.
- **MDCN licence gate (P0):** `assertDoctorApproved` fail-closed — `TELEMEDICINE-SEC-001/002`. A
  soft `is_available` toggle must not bypass it.
- **Object-level PII authz / IDOR (P0):** appointments, prescriptions, SOAP notes, visit summaries
  — `TELEMEDICINE-AUTHZ-002..005`. Clinical PII is P0.
- **Settlement authorization (P0):** only the assigned doctor settles (`TELEMEDICINE-AUTHZ-001`).
- **Float hygiene (P1):** dashboard revenue SQL uses `fee_kobo*0.85` (`TELEMEDICINE-INV-004`) —
  money math should stay integer-kobo (I1).
- **Tier/KYC limits:** the settlement debit is subject to `../cross-cutting/kyc-and-tiers.md`
  fail-closed limit checks — verify a debit over the daily/per-tx limit blocks (503), never allows.
- **Flag gating (P0):** `TELEMEDICINE-SEC-003` → `../cross-cutting/feature-flags-and-audit.md`.

## 7. Automated specs to add

- `internal/telemedicine/service_money_test.go` — integration (build-tagged, real pgx + ledger +
  settlement like `doctor/service_integration_test.go`): Hold-on-book, idempotent replay (no second
  Hold), 85/15 settle kobo-exact, refund idempotent, MDCN-gate fail-closed (no escrow when
  unapproved), slot-collision. Mark TODO in the traceability matrix.
- `internal/telemedicine/authz_test.go` — object-level IDOR for `GetAppointment`, `GetPrescription`,
  `SubmitSOAPNote`, `GetVisitSummary`, `CompleteAppointment` (assigned-doctor-only).
- `internal/telemedicine/dashboard_test.go` — assert `weekly_revenue_kobo` equals integer 85% of
  completed fees and pin the float-arithmetic defect until the SQL is refactored to integer math.
  Follow the gin-`TestMode` + table-driven convention already used in `health_premium_test.go`.

## 8. Coverage target & exit criteria

Tier 0 money-path — pure-logic floor ≥ 85%; money paths must have integration coverage of the
ledger seam. **Exit criteria (all P0 green before release):** `TELEMEDICINE-INT-001/002/003`
(Hold/Settle/Refund kobo-exact + balanced), `TELEMEDICINE-INV-001/002/003` (idempotent replay /
concurrency / refund), `TELEMEDICINE-SEC-001/002` (MDCN gate fail-closed), `TELEMEDICINE-AUTHZ-001..005`
(settlement authz + clinical-PII IDOR), and `TELEMEDICINE-SEC-003` (flag-off). `TELEMEDICINE-INV-004`
(dashboard float) is a tracked defect, not a ship blocker (display-only).
