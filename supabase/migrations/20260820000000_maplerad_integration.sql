-- Migration: maplerad_integration (NGN v1)
-- Customer mapping + provider-reference idempotency + webhook dedupe + drift
-- quarantine for the Maplerad WaaS integration (ADR-012).
-- EXPAND-only (additive). No DROP of tables/columns, no renames, no type narrowing.
--   * The internal ledger is the source of truth and is NOT modified here —
--     Maplerad provenance (source / ref / event_id) rides in the existing
--     ledger_entries.metadata JSONB. Balances stay derived projections.
--   * Money columns are BIGINT kobo.
--   * RLS enabled; service_role (Go pgx) is the sole writer of internal mappings.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) provider_customers — 1 Paymax user ↔ 1 provider customer (created at the
--    required KYC tier; BVN/NIN forwarded to Identity, never stored here).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_customers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider    text        NOT NULL DEFAULT 'maplerad',
  customer_id text        NOT NULL,                 -- provider-side customer id
  status      text        NOT NULL DEFAULT 'active',
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider),
  UNIQUE (provider, customer_id)
);
ALTER TABLE public.provider_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_customers_own ON public.provider_customers;
CREATE POLICY provider_customers_own ON public.provider_customers FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- No write policy → service_role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) provider_reference — client-reference idempotency + the money-op state row.
--    Every Maplerad money call persists its `ref` here BEFORE the call; a retry
--    with the same ref returns the stored result. The transfer/bill state machine
--    operates on `status` (INITIATED→PENDING→{SUCCESS|FAILED|REVERSED}).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_reference (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text        NOT NULL UNIQUE,        -- Paymax client reference = ledger posting ref
  provider      text        NOT NULL DEFAULT 'maplerad',
  provider_ref  text,                               -- provider-returned id/reference
  op_type       text        NOT NULL CHECK (op_type IN ('transfer','bill','collection','payout','wallet')),
  status        text        NOT NULL DEFAULT 'INITIATED'
                              CHECK (status IN ('INITIATED','PENDING','SUCCESS','FAILED','REVERSED')),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_kobo   bigint      CHECK (amount_kobo IS NULL OR amount_kobo >= 0),
  currency      text        NOT NULL DEFAULT 'NGN',
  counterparty  jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {bank_code, account_number_last4, account_name}
  failure_reason text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_reference_status_idx ON public.provider_reference (status, op_type, created_at);
CREATE INDEX IF NOT EXISTS provider_reference_provref_idx ON public.provider_reference (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_reference_user_idx ON public.provider_reference (user_id, created_at DESC);
ALTER TABLE public.provider_reference ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_reference_own ON public.provider_reference;
CREATE POLICY provider_reference_own ON public.provider_reference FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) webhook_event — event-id dedupe store. Webhooks are verified, then deduped
--    here (event_id unique) BEFORE any ledger effect. Reprocessing is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_event (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     text        NOT NULL,
  provider     text        NOT NULL DEFAULT 'maplerad',
  type         text,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'received'
                              CHECK (status IN ('received','processed','failed','ignored')),
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)                       -- idempotency: one row per provider event
);
CREATE INDEX IF NOT EXISTS webhook_event_status_idx ON public.webhook_event (status, received_at);
ALTER TABLE public.webhook_event ENABLE ROW LEVEL SECURITY;  -- service_role only (no policy)

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) reconciliation_drift — quarantine for ledger-vs-custody mismatches. Drift is
--    recorded immutably + alerted; NEVER auto-corrected. Resolution is a
--    human-reviewed compensating ledger entry (recorded as resolved here).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_drift (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text        NOT NULL DEFAULT 'maplerad',
  scope         text        NOT NULL,               -- 'wallet:<userId>' | 'global' | ...
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  expected_kobo bigint      NOT NULL,               -- internal derived balance
  provider_kobo bigint      NOT NULL,               -- provider custody balance
  diff_kobo     bigint      NOT NULL,
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  note          text,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX IF NOT EXISTS reconciliation_drift_status_idx ON public.reconciliation_drift (status, detected_at);
ALTER TABLE public.reconciliation_drift ENABLE ROW LEVEL SECURITY;  -- service_role / admin only

-- updated_at triggers (reuse shared public.handle_updated_at()).
DROP TRIGGER IF EXISTS trg_provider_customers_updated ON public.provider_customers;
CREATE TRIGGER trg_provider_customers_updated BEFORE UPDATE ON public.provider_customers FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_provider_reference_updated ON public.provider_reference;
CREATE TRIGGER trg_provider_reference_updated BEFORE UPDATE ON public.provider_reference FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMIT;
