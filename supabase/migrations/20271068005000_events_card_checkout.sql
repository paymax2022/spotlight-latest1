-- =============================================================================
-- Events — Paystack card / bank-transfer checkout for ticket orders (EVTB-D013).
--
-- Additive-only:
--   1. event_orders.payment_rail ('wallet' default — every existing row and the
--      wallet Purchase path keep their meaning) and event_orders.card_reference
--      (the Paystack reference whose charge pays this order; NULL for wallet).
--      The wallet crash-reconciler (ReconcilePendingOrders) selects ONLY
--      payment_rail='wallet', so it can never wallet-debit a card hold.
--   2. public.event_card_intents — one row per card checkout (one Paystack
--      charge for 1..10 seats). Stores the FROZEN amount the gateway is asked to
--      collect, the hold expiry, and the settle/refund state machine. Holds NO
--      money state: the ledger (DR provider_clearing / CR escrow per order) and
--      event_orders / event_tickets remain the sources of truth.
--
-- The PENDING card orders ARE the inventory hold: they are reserved under the
-- same event_ticket_tiers FOR UPDATE lock as the wallet path (sold < capacity),
-- and released (EXPIRED, sold-1) when the hold expires unpaid or the charge
-- cannot be honoured.
-- =============================================================================

BEGIN;

ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS payment_rail text NOT NULL DEFAULT 'wallet';
ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS card_reference text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_orders_payment_rail_check' AND conrelid = 'public.event_orders'::regclass
  ) THEN
    ALTER TABLE public.event_orders
      ADD CONSTRAINT event_orders_payment_rail_check CHECK (payment_rail IN ('wallet','card'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_orders_card_reference
  ON public.event_orders (card_reference) WHERE card_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.event_card_intents (
  reference         text PRIMARY KEY,                 -- 'evtorder-' || idempotency_key (Paystack reference)
  idempotency_key   text NOT NULL UNIQUE,             -- client Idempotency-Key (money-path idempotency)
  buyer_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id          uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_id           uuid NOT NULL REFERENCES public.event_ticket_tiers(id) ON DELETE CASCADE,
  quantity          int  NOT NULL,
  promo             text NOT NULL DEFAULT '',
  amount_kobo       bigint NOT NULL,                  -- frozen: SUM(event_orders.total_kobo) of the held orders
  currency          text NOT NULL DEFAULT 'NGN',
  status            text NOT NULL DEFAULT 'pending',
  claim_gen         bigint NOT NULL DEFAULT 0,        -- fence: bumped by every claim; writes are conditional on it
  claimed_at        timestamptz,
  hold_expires_at   timestamptz NOT NULL,
  authorization_url text,
  access_code       text,
  collected_kobo    bigint,                           -- what the gateway verified it collected (mismatch/refund evidence)
  refund_reference  text,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_card_intents_status_check') THEN
    ALTER TABLE public.event_card_intents
      ADD CONSTRAINT event_card_intents_status_check
      CHECK (status IN ('pending','processing','confirmed','expired','refunding','refunded'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_card_intents_amount_positive') THEN
    ALTER TABLE public.event_card_intents
      ADD CONSTRAINT event_card_intents_amount_positive CHECK (amount_kobo > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_card_intents_quantity_range') THEN
    ALTER TABLE public.event_card_intents
      ADD CONSTRAINT event_card_intents_quantity_range CHECK (quantity BETWEEN 1 AND 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_card_intents_buyer ON public.event_card_intents (buyer_id, created_at DESC);
-- Sweep scan: open intents by age.
CREATE INDEX IF NOT EXISTS idx_event_card_intents_open
  ON public.event_card_intents (status, created_at)
  WHERE status IN ('pending','processing','refunding');

-- RLS: backend-only (service_role bypasses); no anon/authenticated access — same
-- lockdown posture as restaurant_order_paystack_intents.
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE public.event_card_intents ENABLE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.event_card_intents FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.event_card_intents FROM authenticated';
  END IF;
END $rls$;

COMMIT;
