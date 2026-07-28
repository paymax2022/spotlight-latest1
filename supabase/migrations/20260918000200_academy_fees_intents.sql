-- =============================================================================
-- EdTech School-Fees — payment intents (gap closure for fees/payment IntentStore)
-- Additive-only. Thin reference→(invoice, guardian, amount, key) mapping used to
-- (a) make CreatePaymentIntent idempotent on the Idempotency-Key and (b) resolve a
-- gateway charge.success back to its invoice on confirmation. Stores NO money state
-- — the ledger + academy_invoice_payments remain the sources of truth.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.academy_payment_intents (
  reference        text PRIMARY KEY,
  invoice_id       text NOT NULL,               -- academy_invoices.id (text: matches Go string, no cross-type FK needed for a transient map)
  guardian_user_id text NOT NULL,               -- auth.users.id (string)
  school_id        text,                         -- academy_schools.id (nullable — resolved best-effort)
  amount_minor     bigint NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,         -- money-path idempotency (SF-2 discipline)
  is_installment   boolean NOT NULL DEFAULT false,
  confirmed        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_payment_intents_invoice
  ON public.academy_payment_intents (invoice_id);

-- RLS: backend-only (service_role bypasses); no anon/authenticated access.
DO $rls$
BEGIN
  IF to_regclass('public.academy_payment_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.academy_payment_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.academy_payment_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.academy_payment_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
