-- Merchant onboarding: require a verified/registered CAC business to become a merchant.
-- Additive-only — no DROP, no RENAME, no type narrowing.
--
-- Adds onb_merchant_type.requires_business. Default TRUE so that, when the business
-- registry feature is enabled, submitting/approving a merchant application requires the
-- applicant to hold a verified or registered CAC business. Admins can set FALSE per
-- merchant type that does not need CAC (e.g. an individual medical practitioner).
ALTER TABLE public.onb_merchant_type
    ADD COLUMN IF NOT EXISTS requires_business boolean NOT NULL DEFAULT true;
