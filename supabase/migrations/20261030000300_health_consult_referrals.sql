-- TM-007: consult-generated referrals (to a specialty or an in-person visit).
--
-- During/after a tele-consult the clinician may refer the patient onward. This
-- records the referral tied to the consult, with where it is routed (type +
-- specialty/target provider) so a downstream booker can act on it. Reads are gated
-- to the consult's participants in the service (TM-006).
--
-- ADDITIVE-ONLY: a new table + indexes; nothing existing is altered.

CREATE TABLE IF NOT EXISTS public.health_consult_referrals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_id         uuid NOT NULL REFERENCES public.health_consults(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- provider clinician
  referral_type      text NOT NULL CHECK (referral_type IN ('SPECIALTY','IN_PERSON')),
  specialty          text NOT NULL DEFAULT '',                                    -- e.g. Cardiology
  target_provider_id uuid REFERENCES public.health_providers(id) ON DELETE SET NULL,
  reason             text NOT NULL DEFAULT '',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_referrals_consult ON public.health_consult_referrals (consult_id);
CREATE INDEX IF NOT EXISTS idx_consult_referrals_patient ON public.health_consult_referrals (patient_id);
