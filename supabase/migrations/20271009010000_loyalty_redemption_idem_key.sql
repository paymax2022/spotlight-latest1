-- Additive-only: optional client Idempotency-Key on loyalty redemptions so a
-- retried POST /api/finance/loyalty/redeem returns the original row instead of
-- writing a duplicate PENDING fulfilment (and — via the points.Redeem replay
-- path keyed on the same header — a duplicate ledger debit).
-- Partial unique index: legacy rows and callers that send no header carry NULL
-- and are unaffected.

BEGIN;

ALTER TABLE public.loyalty_redemptions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Scoped per user: a globally-unique key column would let one caller's key
-- shadow another user's redemption insert (phantom debit, row absorbed by the
-- foreign key) — the same wedge class as F-525-1.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_redemptions_idem
  ON public.loyalty_redemptions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
