-- Pre-consult intake: let one intake engine serve the telemedicine appointment plane.
--
-- ADR-010 gates a consult on a SUBMITTED intake, and ADR-010 is titled
-- "TELEMEDICINE Pre-Consultation Health Intake" — but the link entity was built
-- against the health scheduling plane only: appointment_id references
-- health_appointments and provider_id references health_providers, whose domain
-- CHECK allows VET | PHARMACY | LAB. A human telemedicine booking writes
-- `appointments` + `doctors` (internal/telemedicine) and never touches either
-- table, so internal/health/preconsult loadAppointment found no row and answered
-- 404 for every human appointment. The mobile wizard dead-ended, and the patient
-- consult room — which blocks until the same call reports SUBMITTED — was
-- unreachable. The vet path worked because vet books into health_appointments.
--
-- This widens the link row the way consult_sessions already did (migration
-- 20271405000000): one engine, a discriminator naming the plane, and per-plane
-- references instead of a fake row in the health tables. The health-plane FKs
-- stay exactly as they are; a telemedicine intake leaves those columns NULL and
-- pins appointments(id) + doctors(id) in the new ones, so nothing about an
-- existing vet/health intake changes meaning.
-- ADDITIVE-ONLY: ADD COLUMN, DROP NOT NULL (widening), ADD CONSTRAINT, CREATE
-- INDEX, and the idempotent DROP POLICY/CREATE POLICY re-create.
BEGIN;

-- 1) Which plane does this intake belong to? Existing rows are all health-plane,
--    so the default back-fills them without a data rewrite.
ALTER TABLE public.health_preconsult_intake
  ADD COLUMN IF NOT EXISTS appointment_source text NOT NULL DEFAULT 'health';

ALTER TABLE public.health_preconsult_intake
  ADD COLUMN IF NOT EXISTS telemedicine_appointment_id uuid;

ALTER TABLE public.health_preconsult_intake
  ADD COLUMN IF NOT EXISTS doctor_id uuid;

ALTER TABLE public.health_preconsult_intake
  ALTER COLUMN appointment_id DROP NOT NULL;

ALTER TABLE public.health_preconsult_intake
  ALTER COLUMN provider_id DROP NOT NULL;

-- 2) The two planes are mutually exclusive and each one is complete on its own
--    terms. Written as one CHECK so a half-populated row — the shape that would
--    silently orphan an intake from both its appointment and its doctor — cannot
--    be inserted by any caller, including SQL ad-hoc.
ALTER TABLE public.health_preconsult_intake
  ADD CONSTRAINT health_preconsult_intake_appointment_source_check
  CHECK (appointment_source IN ('health','telemedicine'));

ALTER TABLE public.health_preconsult_intake
  ADD CONSTRAINT health_preconsult_intake_one_plane_check
  CHECK (
    (appointment_source = 'health'
       AND appointment_id IS NOT NULL AND provider_id IS NOT NULL
       AND telemedicine_appointment_id IS NULL AND doctor_id IS NULL)
    OR
    (appointment_source = 'telemedicine'
       AND telemedicine_appointment_id IS NOT NULL AND doctor_id IS NOT NULL
       AND appointment_id IS NULL AND provider_id IS NULL)
  );

-- 3) Per-plane references. ON DELETE CASCADE matches the health-plane pair, so
--    deleting an appointment still removes its intake.
ALTER TABLE public.health_preconsult_intake
  ADD CONSTRAINT health_preconsult_intake_telemedicine_appointment_id_fkey
  FOREIGN KEY (telemedicine_appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;

ALTER TABLE public.health_preconsult_intake
  ADD CONSTRAINT health_preconsult_intake_doctor_id_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE CASCADE;

-- 4) One intake per appointment, which the health plane gets from the table-level
--    UNIQUE (appointment_id). NULLs are unbounded in a Postgres UNIQUE, so the
--    telemedicine column needs a partial index to hold the same promise.
CREATE UNIQUE INDEX IF NOT EXISTS preconsult_intake_telemedicine_appt_key
  ON public.health_preconsult_intake (telemedicine_appointment_id)
  WHERE telemedicine_appointment_id IS NOT NULL;

-- 5) Doctor-side reads (summary, queue) key on the assigned doctor now that the
--    provider index does not cover telemedicine rows.
CREATE INDEX IF NOT EXISTS idx_preconsult_intake_doctor
  ON public.health_preconsult_intake (doctor_id, status);

-- 6) RLS — same rule, second plane. The patient branch is untouched (patient_id
--    is populated either way); the provider branch gains the assigned-doctor
--    join so a doctor reading their own appointment's intake is not silently
--    denied where the health plane allows it.
DROP POLICY IF EXISTS preconsult_intake_own ON public.health_preconsult_intake;
CREATE POLICY preconsult_intake_own ON public.health_preconsult_intake FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR EXISTS (SELECT 1 FROM public.health_providers p
               WHERE p.id = health_preconsult_intake.provider_id AND p.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.appointments ta
               JOIN public.doctors d ON d.id = ta.doctor_id
               WHERE ta.id = health_preconsult_intake.telemedicine_appointment_id
                 AND d.user_id = auth.uid())
  );

COMMIT;
