BEGIN;

CREATE TABLE IF NOT EXISTS public.sme_pitch_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  express_interest_id UUID NOT NULL REFERENCES public.sme_pitch_express_interest(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_verification_codes_express_interest_id
  ON public.sme_pitch_verification_codes(express_interest_id);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_verification_codes_email
  ON public.sme_pitch_verification_codes(LOWER(email));

CREATE INDEX IF NOT EXISTS idx_sme_pitch_verification_codes_expires_at
  ON public.sme_pitch_verification_codes(expires_at DESC);

ALTER TABLE public.sme_pitch_verification_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sme_pitch_verification_codes_admin_select" ON public.sme_pitch_verification_codes;
CREATE POLICY "sme_pitch_verification_codes_admin_select"
ON public.sme_pitch_verification_codes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

COMMIT;
