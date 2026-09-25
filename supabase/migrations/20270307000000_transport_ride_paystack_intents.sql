-- =============================================================================
-- Transport (ride-hailing) — Paystack-funded ride intents.
-- Additive-only. Mirrors public.restaurant_order_paystack_intents exactly —
-- same thin-mapping shape, same idempotency discipline, same status machine.
-- Thin reference→(request, rider, amount, key) mapping used to (a) make the
-- checkout-initiate step idempotent on the Idempotency-Key, (b) freeze the
-- exact quoted fare charged to Paystack, and (c) let the confirmation path
-- (verify/webhook) resolve a gateway reference back to the ORIGINAL
-- RequestRideRequest so it can call transport.Service.RequestRidePaystackFunded
-- with the same ride the rider was quoted and charged for.
--
-- Stores NO money state: the ledger (via settlement.EscrowExternal) and the
-- trips/settlements tables remain the sources of truth for anything that
-- actually moved.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.transport_ride_paystack_intents (
  reference        text PRIMARY KEY,
  rider_id         text NOT NULL,
  request_json     jsonb NOT NULL,               -- the frozen RequestRideRequest
  amount_kobo      bigint NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,         -- money-path idempotency
  status           text NOT NULL DEFAULT 'pending', -- pending | processing | confirmed | amount_mismatch | order_failed | refunded
  trip_id          text,                          -- set once RequestRidePaystackFunded succeeds
  refund_reference text,                          -- set if the charge had to be reversed (RefundPayment)
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_transport_ride_paystack_intents_rider
  ON public.transport_ride_paystack_intents (rider_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transport_ride_paystack_intents_status_check'
  ) THEN
    ALTER TABLE public.transport_ride_paystack_intents
      ADD CONSTRAINT transport_ride_paystack_intents_status_check
      CHECK (status IN ('pending', 'processing', 'confirmed', 'amount_mismatch', 'order_failed', 'refunded'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transport_ride_paystack_intents_amount_positive'
  ) THEN
    ALTER TABLE public.transport_ride_paystack_intents
      ADD CONSTRAINT transport_ride_paystack_intents_amount_positive
      CHECK (amount_kobo > 0);
  END IF;
END $$;

-- RLS: backend-only (service_role bypasses); no anon/authenticated access — same
-- lockdown posture as restaurant_order_paystack_intents.
DO $rls$
BEGIN
  IF to_regclass('public.transport_ride_paystack_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.transport_ride_paystack_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.transport_ride_paystack_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.transport_ride_paystack_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
