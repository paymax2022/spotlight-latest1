-- Settlement + provider-tracking fields on crypto_swap_orders.
-- ADDITIVE ONLY: new nullable/defaulted columns; nothing dropped, renamed or narrowed.
-- Read by backend/internal/crypto Repository.GetSwapOrder (GET /crypto/swaps/:id/settlement).
BEGIN;

ALTER TABLE public.crypto_swap_orders
  ADD COLUMN IF NOT EXISTS quotation_id        text,
  ADD COLUMN IF NOT EXISTS swap_transaction_id text,
  ADD COLUMN IF NOT EXISTS provider_status     text,
  ADD COLUMN IF NOT EXISTS ledger_settled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settled_at          timestamptz;

COMMIT;
