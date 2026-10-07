-- Additive-only: optional client Idempotency-Key on loyalty redemptions so a
-- retried POST /api/finance/loyalty/redeem returns the original row instead of
-- writing a duplicate PENDING fulfilment (and — via the points.Redeem replay
-- path keyed on the same header — a duplicate ledger debit).
-- Partial unique index: legacy rows and callers that send no header carry NULL
-- and are unaffected.

BEGIN;

ALTER TABLE public.loyalty_redemptions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redemptions_idem
  ON public.loyalty_redemptions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
