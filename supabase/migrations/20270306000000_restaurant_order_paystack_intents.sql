-- =============================================================================
-- Restaurant food-delivery — Paystack-funded order intents.
-- Additive-only. Thin reference→(request, restaurant, customer, amount, key)
-- mapping used to (a) make the checkout-initiate step idempotent on the
-- Idempotency-Key, (b) freeze the exact quoted amount charged to Paystack, and
-- (c) let the confirmation path (verify/webhook) resolve a gateway reference
-- back to the ORIGINAL PlaceOrderRequest so it can call
-- restaurant.Service.PlaceOrderPaystackFunded with the same cart the customer
-- was quoted and charged for.
--
-- Mirrors public.academy_payment_intents (20260918000200) — same thin-mapping
-- shape, same idempotency discipline. Stores NO money state: the ledger
-- (via settlement.EscrowExternal) and the orders/settlements tables remain
-- the sources of truth for anything that actually moved.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_order_paystack_intents (
  reference        text PRIMARY KEY,
  restaurant_id    text NOT NULL,
  customer_id      text NOT NULL,               -- auth.users.id (string)
  request_json     jsonb NOT NULL,               -- the frozen PlaceOrderRequest (items/promo/tip/packaging/etc.)
  amount_kobo      bigint NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,         -- money-path idempotency (mirrors academy_payment_intents)
  status           text NOT NULL DEFAULT 'pending', -- pending | processing | confirmed | amount_mismatch | order_failed | refunded
  order_id         text,                          -- set once PlaceOrderPaystackFunded succeeds
  refund_reference text,                          -- set if the charge had to be reversed (RefundPayment)
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_restaurant_order_paystack_intents_customer
  ON public.restaurant_order_paystack_intents (customer_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_order_paystack_intents_status_check'
  ) THEN
    ALTER TABLE public.restaurant_order_paystack_intents
      ADD CONSTRAINT restaurant_order_paystack_intents_status_check
      CHECK (status IN ('pending', 'processing', 'confirmed', 'amount_mismatch', 'order_failed', 'refunded'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_order_paystack_intents_amount_positive'
  ) THEN
    ALTER TABLE public.restaurant_order_paystack_intents
      ADD CONSTRAINT restaurant_order_paystack_intents_amount_positive
      CHECK (amount_kobo > 0);
  END IF;
END $$;

-- RLS: backend-only (service_role bypasses); no anon/authenticated access — same
-- lockdown posture as academy_payment_intents.
DO $rls$
BEGIN
  IF to_regclass('public.restaurant_order_paystack_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.restaurant_order_paystack_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.restaurant_order_paystack_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.restaurant_order_paystack_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
