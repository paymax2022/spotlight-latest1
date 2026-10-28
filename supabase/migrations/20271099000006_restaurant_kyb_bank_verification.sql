-- Bank account verification for KYB (FEATURE_KYB_BANK_VERIFICATION).
--
-- ADDITIVE-ONLY: three nullable columns to track bank account verification status.
-- Existing rows keep NULL (verification never ran for them).
--
-- bank_account_verified_at: timestamp when the account was verified (null = never verified)
-- bank_account_verified: boolean indicating if account name matched bank records
-- bank_account_verification_error: error message if verification failed (null = success or not attempted)

ALTER TABLE public.restaurant_kyb
  ADD COLUMN IF NOT EXISTS bank_account_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS bank_account_verified boolean,
  ADD COLUMN IF NOT EXISTS bank_account_verification_error text;

-- Index for filtering verified vs unverified accounts in admin panel
CREATE INDEX IF NOT EXISTS restaurant_kyb_bank_verified_idx
  ON public.restaurant_kyb (bank_account_verified)
  WHERE bank_account_verified_at IS NOT NULL;
