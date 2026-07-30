-- TM-003: tele-consult recording requires consent.
--
-- A consult may only be recorded with explicit, durable consent. Recording captures
-- the patient's PHI, so the conservative rule is TWO-PARTY consent — both the
-- patient and the provider clinician must consent before recording_enabled can be
-- flipped true, and if either withdraws, recording is turned off. This table is the
-- durable, auditable record of who consented and when.
--
-- ADDITIVE-ONLY: a new table + index; the existing health_consults.recording_enabled
-- column (default false) is untouched. No DROP, no rename, no type narrowing.

CREATE TABLE IF NOT EXISTS public.health_consult_recording_consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_id   uuid NOT NULL REFERENCES public.health_consults(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('PATIENT','PROVIDER')),
  consented_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consult_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_consult_rec_consent ON public.health_consult_recording_consents (consult_id);
