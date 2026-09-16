-- Checkout-bound wallet top-ups (ADR-042).
-- Additive-only — no DROP, no RENAME, no type narrowing.
--
-- A top-up raised BY a checkout (card rail, ADR-041) is distinguishable from a
-- standalone wallet funding, so the two can carry different KYC gates: standalone
-- funding still requires Tier 1, while a checkout top-up may be permitted for an
-- unverified account under a capped allowance.
--
-- The column is required for the cap to be enforceable at all: the rolling-window
-- allowance is summed over checkout intents only, so a user's ordinary Tier-1
-- wallet funding never consumes their checkout allowance and vice versa.

ALTER TABLE public.wallet_topup_intents
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'wallet';

-- Every pre-existing intent was raised by the standalone funding screen, which
-- has always required Tier 1 — the DEFAULT already records that faithfully.
ALTER TABLE public.wallet_topup_intents DROP CONSTRAINT IF EXISTS wallet_topup_intents_purpose_check;
ALTER TABLE public.wallet_topup_intents
    ADD CONSTRAINT wallet_topup_intents_purpose_check
    CHECK (purpose IN ('wallet', 'checkout'));

-- The allowance query filters on (user_id, purpose, status, created_at).
CREATE INDEX IF NOT EXISTS idx_topup_intents_user_purpose_created
    ON public.wallet_topup_intents (user_id, purpose, created_at DESC);

COMMENT ON COLUMN public.wallet_topup_intents.purpose IS
    'wallet = standalone funding (Tier 1 required). checkout = raised by a module checkout''s card rail; may be permitted below Tier 1 under a capped rolling allowance (ADR-042).';

-- The tier audit trail needs to name the new decision so a relaxed-gate approval
-- or denial is as auditable as a wallet_daily one.
ALTER TABLE public.tier_limit_events DROP CONSTRAINT IF EXISTS tier_limit_events_limit_type_check;
ALTER TABLE public.tier_limit_events
    ADD CONSTRAINT tier_limit_events_limit_type_check
    CHECK (limit_type IN ('wallet_daily', 'vote_daily', 'checkout_topup'));
