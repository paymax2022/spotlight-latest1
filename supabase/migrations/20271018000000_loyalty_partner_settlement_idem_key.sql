-- Additive-only: client Idempotency-Key + booking actor on Black partner
-- settlements so a retried POST /api/loyalty/admin/black/partner-settlement
-- returns the original row instead of double-booking partner billing.
-- Mirrors 20271017010000_loyalty_perk_redemption_idem_key.sql.
--
-- actor_user_id scopes dedupe to the calling admin (dedupe by admin+key) and
-- records WHO booked the settlement. It is text, not a uuid FK: settlement
-- rows are financial reconciliation records and must survive admin-account
-- deletion (an auth.users FK would either cascade-delete settlements or block
-- account removal).
-- Partial unique index: legacy rows carry NULL and are unaffected.

BEGIN;

ALTER TABLE public.partner_settlements
  ADD COLUMN IF NOT EXISTS actor_user_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Scoped per admin: a globally-unique key column would let one caller's key
-- shadow another admin's settlement insert — the same wedge class as F-525-1.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_settlements_idem
  ON public.partner_settlements (actor_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
