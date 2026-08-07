-- Business registry: store the CAC certificate location once a registration completes,
-- so merchants can view/download their certificate. ADDITIVE (nullable column).
-- Also bump the default registration fee to ₦15,000 (kobo) for any existing rows that
-- were seeded at the old default; the fee charged going forward is set by the service.
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS certificate_url text;
