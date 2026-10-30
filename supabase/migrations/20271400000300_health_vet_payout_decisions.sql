-- Vet admin payout decisions (frontend-admin /admin/health/vet/payouts).
--
-- The vet payout view is DERIVED per provider from RELEASED escrow legs
-- (vet_appointment_payments). Escrow release already credits the vet (HL-9), so
-- an ops decision here moves no money: it is an append-only attestation of the
-- accrual snapshot (released / fees / net, integer kobo) that was reviewed.
-- A newer accrual (more RELEASED legs) is a new snapshot and reads as pending.
--
-- ADDITIVE-ONLY. Rows are never updated or deleted; idempotency_key is UNIQUE so
-- an admin retry replays the original decision instead of writing a second one.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vet_payout_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  decision          text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','KYC_HOLD')),
  released_kobo     bigint NOT NULL CHECK (released_kobo >= 0),
  fees_kobo         bigint NOT NULL CHECK (fees_kobo >= 0),
  net_payable_kobo  bigint NOT NULL,
  note              text NOT NULL DEFAULT '',
  decided_by        uuid NOT NULL REFERENCES auth.users(id),
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_vet_payout_decisions_provider
  ON public.vet_payout_decisions (provider_id, created_at DESC);

ALTER TABLE public.vet_payout_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_payout_decisions_admin_read ON public.vet_payout_decisions;
CREATE POLICY vet_payout_decisions_admin_read ON public.vet_payout_decisions
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS vet_payout_decisions_service ON public.vet_payout_decisions;
CREATE POLICY vet_payout_decisions_service ON public.vet_payout_decisions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
