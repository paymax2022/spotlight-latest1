-- Payout-account name matching (FEATURE_BANK_ACCOUNT_NAME_MATCH).
--
-- ADDITIVE-ONLY: five nullable columns and one partial index on
-- restaurant_bank_accounts. Existing rows keep NULL (matching never ran for
-- them) and keep their current is_verified, so turning the flag on changes
-- nothing for accounts already saved.
--
-- name_match_status:
--   matched        – the bank's holder name matched the owner's KYC-verified
--                    name or an approved KYB legal name; the account is verified.
--   review         – it did not; saved with is_verified=false (withdrawals
--                    refused) until an admin decides.
--   admin_approved – an admin approved a held account (is_verified=true).
--   admin_rejected – an admin rejected it (stays is_verified=false).
-- name_match_score is the matcher's 0–100 score. Names are never copied here.

ALTER TABLE public.restaurant_bank_accounts
  ADD COLUMN IF NOT EXISTS name_match_status text
    CHECK (name_match_status IS NULL OR name_match_status IN ('matched','review','admin_approved','admin_rejected')),
  ADD COLUMN IF NOT EXISTS name_match_score smallint
    CHECK (name_match_score IS NULL OR name_match_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS name_match_decided_by uuid,
  ADD COLUMN IF NOT EXISTS name_match_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS name_match_reason text;

-- The admin review queue reads only held accounts.
CREATE INDEX IF NOT EXISTS restaurant_bank_accounts_name_review_idx
  ON public.restaurant_bank_accounts (created_at)
  WHERE name_match_status = 'review';
