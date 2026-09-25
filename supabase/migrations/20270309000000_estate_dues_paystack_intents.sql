-- =============================================================================
-- Estate dues — Paystack-funded payment intents.
-- Additive-only. Mirrors public.restaurant_order_paystack_intents /
-- public.transport_ride_paystack_intents — same thin-mapping shape, same
-- idempotency discipline, same status machine. Simpler than those two: a
-- dues invoice's amount is fixed and known up front (no cart/route pricing
-- to freeze), so this stores plain estate_id/invoice_id/payer_id columns
-- instead of a frozen request blob.
--
-- Stores NO money state: the ledger (via the DR-provider-clearing/CR-
-- settlement journal payDues posts for an external payment) and
-- estate_payments remain the sources of truth for anything that actually
-- moved.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.estate_dues_paystack_intents (
  reference        text PRIMARY KEY,
  estate_id        text NOT NULL,
  invoice_id       text NOT NULL,
  payer_id         text NOT NULL,
  amount_kobo      bigint NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,         -- money-path idempotency
  status           text NOT NULL DEFAULT 'pending', -- pending | processing | confirmed | amount_mismatch | order_failed | refunded
  payment_id       text,                          -- set once PayDuesPaystackFunded succeeds (estate_payments.id)
  refund_reference text,                          -- set if the charge had to be reversed (RefundPayment)
  created_at       timestamptz NOT NULL DEFAULT now(),
  confirmed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_estate_dues_paystack_intents_payer
  ON public.estate_dues_paystack_intents (payer_id);
CREATE INDEX IF NOT EXISTS idx_estate_dues_paystack_intents_invoice
  ON public.estate_dues_paystack_intents (invoice_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_paystack_intents_status_check'
  ) THEN
    ALTER TABLE public.estate_dues_paystack_intents
      ADD CONSTRAINT estate_dues_paystack_intents_status_check
      CHECK (status IN ('pending', 'processing', 'confirmed', 'amount_mismatch', 'order_failed', 'refunded'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_paystack_intents_amount_positive'
  ) THEN
    ALTER TABLE public.estate_dues_paystack_intents
      ADD CONSTRAINT estate_dues_paystack_intents_amount_positive
      CHECK (amount_kobo > 0);
  END IF;
END $$;

-- RLS: backend-only (service_role bypasses); no anon/authenticated access — same
-- lockdown posture as the sibling intents tables.
DO $rls$
BEGIN
  IF to_regclass('public.estate_dues_paystack_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.estate_dues_paystack_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.estate_dues_paystack_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.estate_dues_paystack_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
