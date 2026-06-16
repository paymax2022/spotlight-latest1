ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS kyc_requested_tier SMALLINT
    CHECK (kyc_requested_tier BETWEEN 1 AND 3);
