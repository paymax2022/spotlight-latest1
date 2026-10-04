-- =============================================================================
-- Film Academy application fee — Paystack charge intents (AUD-FE-003 residual).
-- Additive-only. Thin reference→(applicant, batch, amount) mapping written by
-- POST /api/academy/application-fee/initiate BEFORE the browser opens Paystack,
-- so the charge carries OUR reference and settles server-side even when the
-- client never reaches POST /api/academy/apply — previously a paid charge whose
-- form submit never arrived was orphaned with no record at all.
--
-- It also freezes the SERVER-side quote (academy_settings.application_fee) at
-- charge time, so fulfilment and the apply route reconcile Paystack's
-- confirmed amount against amount_kobo rather than a client-declared figure.
--
-- Mirrors public.openmic_vote_paystack_intents (20270328000000) — same
-- thin-mapping shape, same lockdown posture. Stores NO money state:
-- academy_applications.payment_reference remains the dedup anchor for the
-- application itself; this row only proves the charge happened.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.academy_application_fee_intents (
  reference            text PRIMARY KEY,          -- academy-fee-<uuid> minted at initiate
  user_id              uuid,                      -- auth.users.id of the applicant (nullable for safety)
  email                text NOT NULL,
  full_name            text NOT NULL,
  batch_id             uuid,                      -- academy_batches.id — nullable: chosen later on the form is legal
  amount_kobo          bigint NOT NULL,           -- server quote: academy_settings.application_fee × 100
  status               text NOT NULL DEFAULT 'pending',
  provider_reference   text,                      -- Paystack transaction id once verified
  verified_amount_kobo bigint,                    -- what Paystack ACTUALLY collected
  paid_at              timestamptz,
  application_id       uuid,                      -- set on consume → academy_applications.id
  consumed_at          timestamptz,
  failure_reason       text,
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_application_fee_intents_status
  ON public.academy_application_fee_intents (status);

CREATE INDEX IF NOT EXISTS idx_academy_application_fee_intents_user
  ON public.academy_application_fee_intents (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academy_application_fee_intents_status_check'
  ) THEN
    ALTER TABLE public.academy_application_fee_intents
      ADD CONSTRAINT academy_application_fee_intents_status_check
      CHECK (status IN ('pending', 'paid', 'amount_mismatch', 'failed', 'consumed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academy_application_fee_intents_amount_positive'
  ) THEN
    ALTER TABLE public.academy_application_fee_intents
      ADD CONSTRAINT academy_application_fee_intents_amount_positive
      CHECK (amount_kobo > 0);
  END IF;
END $$;

COMMENT ON TABLE public.academy_application_fee_intents IS
  'Reference-keyed pending record for Film Academy application-fee charges. '
  'Written at initiate so webhook/recover/apply can settle a charge whose '
  'client never submitted the application form. academy_applications '
  '.payment_reference anchors the application; this table stores no money state.';

-- Service-role only: initiate/apply/webhook/recover run through createAdminClient.
DO $rls$
BEGIN
  IF to_regclass('public.academy_application_fee_intents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.academy_application_fee_intents ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.academy_application_fee_intents FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.academy_application_fee_intents FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
