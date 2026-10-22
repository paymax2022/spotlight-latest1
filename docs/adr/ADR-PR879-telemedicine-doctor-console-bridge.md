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

## Consequences
- The rest of the `doctor_*` tables still carry Supabase's default grants. Locking them down is a follow-up, done the same way.
- A console transition whose sync fails after retries leaves the booking unsettled until a person re-runs it. There is no automatic reconciler yet.
- Pinned by `telemedicine/bridge_hardening_live_db_test.go` (planted rows, thread hijack, foreign actor, status matrix with settle-once, in-progress cancel, closed-appointment call token, triage on edit, intake authz matrix, flag off, PostgREST lockdown) and `doctor/console_write_ownership_live_db_test.go`.
