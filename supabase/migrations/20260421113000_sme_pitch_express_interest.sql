BEGIN;

CREATE TABLE IF NOT EXISTS public.sme_pitch_express_interest (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_whatsapp TEXT NOT NULL,
  venture_stage TEXT NOT NULL,
  sector TEXT NOT NULL,
  location_state TEXT NOT NULL,
  short_venture_description TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  source_channel TEXT NOT NULL DEFAULT 'web',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_express_interest_email
  ON public.sme_pitch_express_interest (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_sme_pitch_express_interest_created_at
  ON public.sme_pitch_express_interest (created_at DESC);

ALTER TABLE public.sme_pitch_express_interest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sme_pitch_express_interest_admin_select" ON public.sme_pitch_express_interest;
CREATE POLICY "sme_pitch_express_interest_admin_select"
ON public.sme_pitch_express_interest
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

COMMIT;
