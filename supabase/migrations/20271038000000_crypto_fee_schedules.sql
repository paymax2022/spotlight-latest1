-- Crypto swap fee schedule: versioned, append-only (ADR-PR759).
--
-- ADDITIVE-ONLY. Safe to re-run. Service-role only (admin API behind the Go backend).
-- Each row is one complete, immutable schedule; the ACTIVE schedule is the row with the highest
-- version. No row means the code default applies. A change is a new row, never an UPDATE, so
-- the history of who set which markup and why can never be rewritten. A swap stores the bps it
-- was quoted at, so a new version never reprices an open swap.
--   * version is the optimistic-concurrency token: a writer states the version it read.
--   * idempotency_key is unique: a retried request cannot append a second row.
--   * the hard ceiling (150 bps) lives in application code, not here, so it is a reviewed
--     code change to raise it; the CHECKs below are only sanity bounds.

CREATE TABLE IF NOT EXISTS public.crypto_fee_schedules (
  version         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  major_bps       INTEGER NOT NULL CHECK (major_bps BETWEEN 0 AND 10000),
  other_bps       INTEGER NOT NULL CHECK (other_bps BETWEEN 0 AND 10000),
  majors          TEXT[]  NOT NULL,
  overrides       JSONB   NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  reason          TEXT    NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by      TEXT    NOT NULL,
  idempotency_key TEXT    NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: refuse UPDATE and DELETE, so the history is evidence.
CREATE OR REPLACE FUNCTION public.crypto_fee_schedules_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crypto_fee_schedules is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_crypto_fee_schedules_immutable ON public.crypto_fee_schedules;
CREATE TRIGGER trg_crypto_fee_schedules_immutable
  BEFORE UPDATE OR DELETE ON public.crypto_fee_schedules
  FOR EACH ROW EXECUTE FUNCTION public.crypto_fee_schedules_immutable();

-- TRUNCATE bypasses row triggers, so refuse it with a statement trigger and take the privilege away.
DROP TRIGGER IF EXISTS trg_crypto_fee_schedules_no_truncate ON public.crypto_fee_schedules;
CREATE TRIGGER trg_crypto_fee_schedules_no_truncate
  BEFORE TRUNCATE ON public.crypto_fee_schedules
  FOR EACH STATEMENT EXECUTE FUNCTION public.crypto_fee_schedules_immutable();
REVOKE TRUNCATE ON public.crypto_fee_schedules FROM PUBLIC;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.crypto_fee_schedules ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_fee_schedules_service ON public.crypto_fee_schedules';
  EXECUTE 'CREATE POLICY crypto_fee_schedules_service ON public.crypto_fee_schedules FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;
