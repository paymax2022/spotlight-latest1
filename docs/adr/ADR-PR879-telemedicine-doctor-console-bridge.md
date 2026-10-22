# ADR-PR879: Telemedicine ↔ doctor-console bridge and pre-consult intake

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** telemedicine / doctor console (money path, PHI)
**Flags:** `FEATURE_TELEMEDICINE_CONSOLE_BRIDGE_ENABLED`, `FEATURE_TELEMEDICINE_INTAKE_ENABLED` (both default off)

## Context
A telemedicine booking is the patient's view of a consult. The doctor works in a separate doctor console (`doctor_appointments`, chat threads, clinical notes, prescriptions). The bridge joins the two:
- it mirrors bookings into the console;
- it reads console prescriptions and notes back to the patient;
- it shares one chat thread between them;
- it issues LiveKit call tokens;
- it syncs console lifecycle moves back to the booking. "Completed" settles the fee and "cancelled" refunds it.

The pre-consult intake stores the patient's questionnaire answers and a red-flag triage outcome.

A security review of the first version found several problems:
- **Forged content.** The readbacks trusted any console row carrying the appointment id, and PostgREST let any user insert one. Anyone could therefore show a patient a forged prescription.
- **Chat hijack.** Chat resolved by appointment id alone, so a planted thread could capture patient messages.
- **Unchecked sync.** The sync never checked who was acting.
- **Refund abuse.** A patient could cancel, and be refunded for, a consult that had already started.

## Decision
- **Everything is behind two flags, both default off.** Off, booking, completion and refunds behave exactly as before. The bridge routes (chat, call token) and the console reverse sync are only wired when the bridge flag is on. LiveKit mounts only when academy or the bridge needs it.
- **The assigned doctor is the only trusted console author.**
  - The readbacks join `appointments → doctors.user_id = row.user_id`.
  - The chat thread lookup uses the same join.
  - `SyncFromDoctorConsole` returns `ErrSyncActorNotDoctor` for anyone else.
  - On the console side, notes and prescriptions that name an appointment must name one the caller owns (`assertOwnAppointment`).
- **One chat thread per appointment.** A partial unique index enforces it, built only when no duplicates exist, so the migration never deletes data.
- **Money stays single-sourced.** The sync calls `CompleteAppointment` and `CancelAppointment`, both idempotent; the console never touches the ledger. A completed consult cannot be refunded by a later cancel. A patient cannot cancel or reschedule once the consult is `in_progress`. A failed sync is retried three times; an unsettled consult keeps its escrow held, so nothing is lost.
- **Call tokens** are issued only for booked, confirmed or in-progress appointments. Non-participants get 404.
- **Intake:**
  - Triage re-runs on every edit after submit, and the outcome only ever rises.
  - The body is capped at 64 KB.
  - The patient is the only writer.
  - A doctor's read is audited.
- **PostgREST lockdown** (ADR-PR858 pattern): no `anon`/`authenticated` privileges on `telemedicine_intakes`, `doctor_appointments`, `doctor_chat_threads`, `doctor_chat_messages`, `doctor_prescriptions`, `doctor_prescription_items` or `doctor_clinical_notes`. Only the Go backend (`service_role`) uses them.
- **Migrations** use fresh stamps:
  - `20271089000000` widens the appointments status CHECK. It finds the constraint through `pg_constraint`, because the original is auto-named.
  - `20271090000000` adds the intake table.
  - `20271091000000` adds the thread uniqueness index and the revokes.

## Closing an appointment: claim, then pay, then reconcile
The ledger audit found two problems that blocked turning the bridge on:
- The old close moved the money and then flipped the appointment in a separate, unconditional UPDATE, so a dropped request could leave them disagreeing for good.
- Nothing let a patient recover escrow from a consult that started and never ended.

Every close (`telemedicine/close.go`) now works like this:
1. **Claim.** One conditional UPDATE moves the appointment to `completed` or `cancelled`, only from a state the actor may close from, and stamps `closed_at`. Complete and cancel race to that row; exactly one wins.
2. **Pay.** Settle or refund through the idempotent settlement service, on a context the caller cannot cancel. Each settle and refund writes an audit row (`telemedicine.appointment.settled` / `.refunded`, with actor, amounts and reason).
3. **Reconcile.** `ReconcileConsults`, on a 10-minute ticker, finishes any claim whose payment did not land. It also queues a consult `in_progress` for more than 12 h (`StuckConsultAfter`) for admin review. A patient can queue a started consult themselves (`report-problem`). An admin settles or refunds from the review queue through the same audited path (`telemedicine.admin.manage`).

Why not one transaction across the appointment lock and Settle: settlement opens its own pool connections, and holding a transaction connection while acquiring another starves the pool under load (settlement's own warning).

The console side changed too:
- Its terminal states are final: same-state repeats stay idempotent.
- A patient cancel is mirrored onto the console row.
- End records commission only once the telemedicine escrow actually settled.
- The sync runs detached from the request and does not retry permanent refusals.

`ConfirmAppointment` became conditional as well. Migration `20271092000000` adds `closed_at`, `review_required_at` and `review_reason`.

The claim also requires the escrow to still be payable in that direction, and a linked doctor account for a settle. A close that cannot pay leaves the appointment open with a clear error, instead of terminal with the escrow stuck.

Admins can resolve only appointments in the review queue. Their decision and reason are audited when they claim, before payment. A payment the reconciler finds permanently refused goes to the review queue rather than being retried forever.

Migration `20271093000000` revokes PostgREST access to `doctor_compliance_audit` and `appointments`:
- the actor recorded on an audit row could otherwise edit or delete it through the old `FOR ALL` owner policy;
- `appointments.review_reason` holds the patient's complaint, which the assigned doctor could otherwise read.

These close-path changes apply whether or not the bridge flag is on. They only refuse races the old code lost, and heal what it left half-done.

## Consequences
- The rest of the `doctor_*` tables still carry Supabase's default grants. Locking them down is a follow-up, done the same way.
- The settlement split still computes 15% with a float (`settlement/service.go`). It is exact for every fee up to ₦300k (verified), but should move to integer basis points in the shared settlement package.
- Pinned by `telemedicine/bridge_hardening_live_db_test.go` (planted rows, thread hijack, foreign actor, status matrix with settle-once, in-progress cancel, closed-appointment call token, triage on edit, intake authz matrix, flag off, PostgREST lockdown) and `doctor/console_write_ownership_live_db_test.go`.
