-- Crypto operational controls: versioned, append-only (ADR-PR859).
--
-- ADDITIVE-ONLY. Safe to re-run. Service-role only (admin API behind the Go backend).
-- Each row is one complete state (trading pause, withdrawal kill switch, disabled markets,
-- per-trade limit, customer banner); the ACTIVE state is the highest version. No row means
-- everything is open. A change is a new row, never an UPDATE, so who paused what and why
-- can never be rewritten. version is the optimistic-concurrency token; idempotency_key is
-- unique so a retried request cannot append twice. The audit row is written in the same
-- transaction as the change (crypto_audit_log).

CREATE TABLE IF NOT EXISTS public.crypto_controls (
  version             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trading_paused      BOOLEAN NOT NULL DEFAULT false,
  withdrawals_paused  BOOLEAN NOT NULL DEFAULT false,
  disabled_assets     TEXT[]  NOT NULL DEFAULT '{}',
  max_quote_kobo      BIGINT  NOT NULL DEFAULT 0 CHECK (max_quote_kobo >= 0),
  banner_message      TEXT    CHECK (banner_message IS NULL OR length(banner_message) BETWEEN 1 AND 280),
  banner_severity     TEXT    CHECK (banner_severity IS NULL OR banner_severity IN ('info','warning','critical')),
  reason              TEXT    NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by          TEXT    NOT NULL,
  idempotency_key     TEXT    NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((banner_message IS NULL) = (banner_severity IS NULL))
);

CREATE OR REPLACE FUNCTION public.crypto_controls_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crypto_controls is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_crypto_controls_immutable ON public.crypto_controls;
CREATE TRIGGER trg_crypto_controls_immutable
  BEFORE UPDATE OR DELETE ON public.crypto_controls
  FOR EACH ROW EXECUTE FUNCTION public.crypto_controls_immutable();

DROP TRIGGER IF EXISTS trg_crypto_controls_no_truncate ON public.crypto_controls;
CREATE TRIGGER trg_crypto_controls_no_truncate
  BEFORE TRUNCATE ON public.crypto_controls
  FOR EACH STATEMENT EXECUTE FUNCTION public.crypto_controls_immutable();
REVOKE TRUNCATE ON public.crypto_controls FROM PUBLIC;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.crypto_controls ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS crypto_controls_service ON public.crypto_controls';
  EXECUTE 'CREATE POLICY crypto_controls_service ON public.crypto_controls FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
END $$;
