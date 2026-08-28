-- Record WHAT a card top-up was actually for.
--
-- Since ADR-041 the card rail funds the wallet and then spends it, so every
-- module checkout — a vote purchase, a food order, a consultation fee — is
-- written as an indistinguishable "wallet top-up". The purchase that raised it
-- is knowable at the moment the intent is created, but was thrown away: the
-- checkout's domain reached the Paystack popup's client-side metadata and
-- nothing else. Neither the intent nor the ledger could answer "what did this
-- ₦10,000 buy?".
--
-- Additive and nullable. A standalone wallet funding leaves it NULL, which is
-- the honest value — that money really is just a top-up. Existing rows keep
-- NULL rather than being guessed at.
--
-- Deliberately NOT constrained to a fixed list: the set of checkout domains
-- grows with every module, and a CHECK here would mean a migration for each new
-- one, with a failed insert — losing a payment — as the penalty for forgetting.
-- The API sanitises the shape instead.
--
-- See ADR-PR<pr-number>-topup-checkout-domain.

ALTER TABLE public.wallet_topup_intents
  ADD COLUMN IF NOT EXISTS checkout_domain text;

COMMENT ON COLUMN public.wallet_topup_intents.checkout_domain IS
  'What the checkout was buying (e.g. vote_purchase, food_order) when purpose = ''checkout''. NULL for standalone wallet funding.';

-- Answers "show me every card payment for votes" without a scan of the ledger.
CREATE INDEX IF NOT EXISTS idx_wallet_topup_intents_checkout_domain
  ON public.wallet_topup_intents (checkout_domain)
  WHERE checkout_domain IS NOT NULL;
