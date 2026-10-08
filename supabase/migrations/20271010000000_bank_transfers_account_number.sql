-- Migration: bank_transfers.account_number — persist the full destination NUBAN.
-- ADDITIVE ONLY: ADD COLUMN IF NOT EXISTS (nullable) + a permissive shape CHECK.
--
-- Why: the payout leg re-reads the bank_transfers row after claiming the leg
-- lock, but the table only stored account_number_last4 — so the provider's
-- RecipientRequest was built from a 4-digit "account number". Every real
-- provider rejects that shape (permanent wedge), and the beneficiary/recipient
-- caches were keyed by last4, colliding across different full accounts.
--
-- The column is nullable: rows written before this migration have only last4
-- and there is nothing to backfill them from. The Go leg treats a missing or
-- non-NUBAN value as fail-closed — such a row parks in its reserved/funded
-- hold state for manual reconciliation rather than firing a malformed payout.

BEGIN;

ALTER TABLE public.bank_transfers
  ADD COLUMN IF NOT EXISTS account_number TEXT;

-- Shape guard: either NULL (pre-migration rows) or a full 10-digit NUBAN.
-- This is the exact class of bug being fixed — a writer that stores a last4
-- fragment here fails loudly at INSERT instead of wedging a payout downstream.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_transfers_account_number_nuban') THEN
    ALTER TABLE public.bank_transfers ADD CONSTRAINT bank_transfers_account_number_nuban
      CHECK (account_number IS NULL OR account_number ~ '^\d{10}$');
  END IF;
END $$;

COMMENT ON COLUMN public.bank_transfers.account_number IS
  'Full destination NUBAN (10 digits) for the provider payout leg — server-side only. '
  'account_number_last4 remains the display field. NULL on rows written before '
  '20271010000000; the payout leg refuses those rather than send a truncated number.';

COMMIT;
