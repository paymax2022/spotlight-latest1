-- Slice 2: one live consult session per module appointment, and the module
-- booking row's pin to the price point the patient picked. The duration is
-- copied onto the booking row too: a package price may be edited later, and a
-- session must always last what the patient paid for.
-- ADDITIVE-ONLY: one index + six nullable columns.
BEGIN;

-- The replay anchor. A retried open-session call converges on the row this
-- index protects instead of minting a second room (see EnsureSession).
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_sessions_source
  ON public.consult_sessions (vertical, source_ref);

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS consult_package_id uuid
    REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consult_mode text
    CONSTRAINT appointments_consult_mode_check
    CHECK (consult_mode IN ('chat','voice','video')),
  ADD COLUMN IF NOT EXISTS consult_duration_minutes int
    CONSTRAINT appointments_consult_duration_check
    CHECK (consult_duration_minutes BETWEEN 5 AND 480);

ALTER TABLE public.vet_appointment_payments
  ADD COLUMN IF NOT EXISTS consult_package_id uuid
    REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consult_mode text
    CONSTRAINT vet_appt_consult_mode_check
    CHECK (consult_mode IN ('chat','voice','video')),
  ADD COLUMN IF NOT EXISTS consult_duration_minutes int
    CONSTRAINT vet_appt_consult_duration_check
    CHECK (consult_duration_minutes BETWEEN 5 AND 480);

COMMIT;
