-- SOC-039: connect_onboarding gates `status = 'complete'` on phone_verified,
-- but no write path ever set it — onboarding could never complete. The
-- phone-verify endpoints (OTP via SMS) need somewhere to keep the number
-- pending verification. Additive-only; nullable, no default.

BEGIN;

ALTER TABLE public.connect_onboarding
  ADD COLUMN IF NOT EXISTS phone text;

COMMIT;
