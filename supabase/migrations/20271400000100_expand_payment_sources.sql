-- Migration: expand_payment_sources
-- Additive: widen the utility_transactions.payment_source check to accept the
-- transfer and cash rails, which the commission earnings enricher surfaces
-- (backend/internal/finance/commission/payment_enricher.go).

ALTER TABLE public.utility_transactions
  DROP CONSTRAINT IF EXISTS utility_transactions_payment_source_check,
  ADD CONSTRAINT utility_transactions_payment_source_check
    CHECK (payment_source IN ('wallet', 'paystack', 'transfer', 'cash'));

CREATE INDEX IF NOT EXISTS idx_utility_transactions_id_payment_source
  ON public.utility_transactions(id, payment_source);
