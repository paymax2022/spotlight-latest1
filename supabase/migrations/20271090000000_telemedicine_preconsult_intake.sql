-- Migration: telemedicine_preconsult_intake
-- Module: Telemedicine (patient pre-consult intake for a booked consult)
-- ADDITIVE ONLY. No DROP, no renames, no type narrowing.
--
-- Why this table exists: the pre-consult intake the patient app ships
-- (src/features/health/api/preconsult.mock.ts PRECONSULT_SCHEMA) was built on the
-- health platform, and `health_preconsult_intake` hard-FKs appointment_id to
-- `health_appointments(id)` and provider_id to `health_providers(id)`. A
-- telemedicine booking lives in `appointments` with `doctors`, so a telemedicine
-- appointment id can never satisfy those constraints — the intake endpoints 404
-- for every real booking. That left the app's own structural gate unreachable:
-- the appointment screen disables "Join consultation" until the intake reports
-- SUBMITTED, so a patient who paid could never enter the consult, and the
-- pre-booking answers collected before payment had no server-side home.
--
-- This table is the telemedicine-scoped twin of that link row: one row per
-- appointment, DRAFT answers autosaved, and a SUBMITTED snapshot that carries the
-- red-flag outcome captured at submit time (decision support for the doctor,
-- never a diagnosis). PHI: RLS enabled, visible to the patient and the assigned
-- doctor only; the Go service writes through service_role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS public.telemedicine_intakes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_id       uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  -- The schema ships with the app; the row records which definition answered.
  schema_id       text NOT NULL DEFAULT 'preconsult_v1',
  schema_version  int  NOT NULL DEFAULT 1,
  consent_version text,
  consent_at      timestamptz,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  answers_json    jsonb NOT NULL DEFAULT '{}'::jsonb,     -- autosaved answers; the submit snapshot
  -- Captured at submit from the structured symptom/severity answers.
  red_flag_severity text CHECK (red_flag_severity IN ('emergency','urgent')),
  red_flag_routing  text CHECK (red_flag_routing IN ('EMERGENCY','URGENT_CARE','CRISIS')),
  red_flag_hits   jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{code, severity, routing}]
  submitted_at    timestamptz,
  version         int NOT NULL DEFAULT 0,                 -- optimistic lock
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tele_intake_patient  ON public.telemedicine_intakes (patient_id);
CREATE INDEX IF NOT EXISTS idx_tele_intake_doctor   ON public.telemedicine_intakes (doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_tele_intake_redflag  ON public.telemedicine_intakes (red_flag_severity)
  WHERE red_flag_severity IS NOT NULL;

DROP TRIGGER IF EXISTS trg_tele_intake_updated ON public.telemedicine_intakes;
CREATE TRIGGER trg_tele_intake_updated BEFORE UPDATE ON public.telemedicine_intakes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE public.telemedicine_intakes IS
  'Patient-reported pre-consult intake for a telemedicine appointment (one row per appointment).';

-- ─── RLS — patient + assigned doctor read; service_role writes ────────────────
ALTER TABLE public.telemedicine_intakes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tele_intake_select ON public.telemedicine_intakes;
CREATE POLICY tele_intake_select ON public.telemedicine_intakes FOR SELECT TO authenticated
  USING (
    patient_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.doctors d
               WHERE d.id = telemedicine_intakes.doctor_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS tele_intake_service ON public.telemedicine_intakes;
CREATE POLICY tele_intake_service ON public.telemedicine_intakes TO service_role
  USING (TRUE) WITH CHECK (TRUE);

COMMIT;
