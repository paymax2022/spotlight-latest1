-- Persist the learner's minor-safety attributes on the academy profile.
--
-- academy_profiles stored role/class/stream/entry_year but NOT date of birth,
-- minor status or KYC tier — yet the mobile onboarding collects dob → isMinor and
-- the whole child-safety gate (consent-fail-closed on spend/redeem) keys off
-- isMinor. Without these columns the identity/profile API can't round-trip minor
-- status, so a live profile would silently drop it on reload and re-open the
-- consent gate for minors. Add them so identity can go live safely.
--
-- Additive/expand-only: new nullable/defaulted columns; existing rows unaffected.
ALTER TABLE public.academy_profiles
  ADD COLUMN IF NOT EXISTS dob       date,
  ADD COLUMN IF NOT EXISTS is_minor  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kyc_tier  integer NOT NULL DEFAULT 0;
