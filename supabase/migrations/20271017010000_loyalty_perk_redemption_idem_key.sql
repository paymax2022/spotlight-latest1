-- Additive-only: client Idempotency-Key on Black perk redemptions so a retried
-- POST /api/finance/loyalty/black/redeem returns the original row instead of
-- minting a second single-use credential and writing a duplicate redemption.
-- Mirrors 20271009010000_loyalty_redemption_idem_key.sql.
-- Partial unique index: legacy rows carry NULL and are unaffected.

BEGIN;

ALTER TABLE public.perk_redemptions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Scoped per user: a globally-unique key column would let one caller's key
-- shadow another user's redemption insert — the same wedge class as F-525-1.
CREATE UNIQUE INDEX IF NOT EXISTS uq_perk_redemptions_idem
  ON public.perk_redemptions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
