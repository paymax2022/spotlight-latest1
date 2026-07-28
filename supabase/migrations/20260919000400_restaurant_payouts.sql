-- Restaurant / rider payout-run disbursement subsystem.
--
-- Replaces the read-only settlement-projection view (admin_repo.go
-- AdminPayoutRuns) with a REAL, auditable disbursement layer. A payout run
-- aggregates settled-but-unpaid `settlements` for one provider (restaurant owner
-- or rider) in one period into a draft, then ProcessRun posts ONE balanced
-- ledger transfer (DR settlement standing account, CR provider wallet) keyed on
-- the run's idempotency_key and flips draft->processing->paid under a status
-- guard. No shadow ledger: money moves ONLY through public.ledger_entries via the
-- ledger service. Payout lines are append-only provenance rows.
--
-- ADDITIVE-ONLY: new tables only; IF NOT EXISTS + to_regclass guards; no DROP, no
-- column rename, no type narrowing. A partial replay is a safe no-op.
--
-- All monetary amounts are integer minor units (kobo) — BIGINT, never float.
BEGIN;

-- ─── restaurant_payout_runs ───────────────────────────────────────────────────
-- One disbursement run per (provider_type, provider_id, period_key). The
-- idempotency_key is UNIQUE and is the SAME key handed to the ledger transfer, so
-- a replayed ProcessRun converges to exactly one posting. ledger_reference is the
-- human-readable ledger ref stamped after a successful post.
CREATE TABLE IF NOT EXISTS public.restaurant_payout_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_key      text        NOT NULL,
  provider_type   text        NOT NULL CHECK (provider_type IN ('restaurant','rider')),
  provider_id     uuid        NOT NULL,
  gross_minor     bigint      NOT NULL DEFAULT 0 CHECK (gross_minor >= 0),
  fee_minor       bigint      NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  net_minor       bigint      NOT NULL DEFAULT 0 CHECK (net_minor >= 0),
  status          text        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','processing','paid','failed')),
  idempotency_key text        NOT NULL UNIQUE,
  ledger_reference text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- One draft run per provider+period (idempotent BuildRun). A run that has already
-- been built is re-used rather than duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_payout_runs_provider_period
  ON public.restaurant_payout_runs (provider_type, provider_id, period_key);
CREATE INDEX IF NOT EXISTS idx_restaurant_payout_runs_status
  ON public.restaurant_payout_runs (status);
CREATE INDEX IF NOT EXISTS idx_restaurant_payout_runs_provider
  ON public.restaurant_payout_runs (provider_id);

-- ─── restaurant_payout_lines ──────────────────────────────────────────────────
-- Append-only provenance: one line per settlement/order folded into a run. Never
-- updated or deleted (correction = a reversing run, not a line edit). The unique
-- (run_id, settlement_id) prevents the same settlement being counted twice within
-- a run on a BuildRun replay.
CREATE TABLE IF NOT EXISTS public.restaurant_payout_lines (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid        NOT NULL REFERENCES public.restaurant_payout_runs(id) ON DELETE CASCADE,
  order_id      uuid,
  settlement_id uuid,
  amount_minor  bigint      NOT NULL CHECK (amount_minor >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_payout_lines_run
  ON public.restaurant_payout_lines (run_id);
-- A settlement contributes to at most one line per run (idempotent line append).
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_payout_lines_run_settlement
  ON public.restaurant_payout_lines (run_id, settlement_id)
  WHERE settlement_id IS NOT NULL;
-- A settlement can only ever be disbursed by ONE run (guards against a second run
-- re-paying an already-paid settlement across periods).
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_payout_lines_settlement
  ON public.restaurant_payout_lines (settlement_id)
  WHERE settlement_id IS NOT NULL;

-- ─── RLS: backend-only lockdown (service_role bypasses) ───────────────────────
-- These are money-path tables; only the Go backend (service_role) writes/reads
-- them. No anon/authenticated policy is granted. Guarded with to_regclass so a
-- partial replay is a no-op.
DO $$
BEGIN
  IF to_regclass('public.restaurant_payout_runs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.restaurant_payout_runs ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS restaurant_payout_runs_service ON public.restaurant_payout_runs';
    EXECUTE 'CREATE POLICY restaurant_payout_runs_service ON public.restaurant_payout_runs FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
  IF to_regclass('public.restaurant_payout_lines') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.restaurant_payout_lines ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS restaurant_payout_lines_service ON public.restaurant_payout_lines';
    EXECUTE 'CREATE POLICY restaurant_payout_lines_service ON public.restaurant_payout_lines FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END $$;

COMMIT;
