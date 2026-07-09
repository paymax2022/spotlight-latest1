-- Paymax × Spotlight — Crypto on-chain balance store (custody feed → reconciliation)
-- Ref: 20260815001600_crypto.sql (crypto_assets, crypto_holdings, RLS + service_role
--      lockdown pattern), 20260901001200_crypto_swap_withdrawal_addresses.sql
--      (crypto_withdrawals parked-units side of the ledger projection).
--
-- WHY THIS MIGRATION EXISTS
-- The crypto admin reconciliation surface (backend/internal/crypto/admin_service.go
-- AdminReconciliation → frontend-admin/app/admin/crypto/reconciliation) previously
-- reported onchain_units == ledger_units, i.e. drift was ALWAYS 0 and status always
-- "ok". That is not real reconciliation — it can never surface a break. To make the
-- report truthful we need a place to store what the CUSTODIAN says is actually on
-- chain, independently of the internal ledger projection. Reconciliation then diffs
-- the two.
--
-- This table holds ONE row per asset: the custodian-reported total on-chain balance
-- for that asset (integer minor units, matching crypto_holdings.units / crypto_assets
-- .minor_unit_scale). It is written ONLY by the custody-webhook seam
-- (POST /api/v1/crypto/internal/onchain-balance → Repository.UpsertOnchainBalance),
-- and read ONLY by reconciliation. Reconciliation is READ-ONLY: it reports drift, it
-- never moves money. This table is NOT a ledger and is NOT a balance source of truth
-- for members — holdings remain the projection of the ledger.
--
-- ADDITIVE-ONLY. New table only; IF NOT EXISTS + to_regclass guards; no DROP, no
-- rename, no type change, no existing row/table touched. Backend-only RLS lockdown
-- (service_role writes; is_admin() may read for the console) mirrors the admin_only
-- tables in 20260815001600_crypto.sql. All amounts are integer minor units.

BEGIN;

-- ── On-chain balances (custodian-reported; one row per asset) ─────────────────
-- asset_id      → FK to crypto_assets. PRIMARY KEY: exactly one custody total per asset.
-- onchain_units → integer asset minor units the custodian reports held on chain.
--                 bigint minor units (NEVER float). >= 0 (a custodian never reports a
--                 negative custody total).
-- source        → free-text provenance tag (e.g. 'fireblocks','bitgo','stub','manual')
--                 so the console can show where the number came from.
-- as_of         → custodian's own timestamp for the balance snapshot (what time the
--                 on-chain total was true), distinct from updated_at (when WE stored it).
-- updated_at    → server write time; bumped on every upsert.
CREATE TABLE IF NOT EXISTS public.crypto_onchain_balances (
  asset_id     uuid PRIMARY KEY REFERENCES public.crypto_assets(id) ON DELETE CASCADE,
  onchain_units bigint NOT NULL DEFAULT 0 CHECK (onchain_units >= 0),
  source       text NOT NULL DEFAULT 'stub',
  as_of        timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: backend-only lockdown ────────────────────────────────────────────────
-- Writes only via service_role (the Go backend / custody webhook seam). is_admin()
-- may SELECT so the admin console reconciliation view can render. Members never see
-- this table. Guarded with to_regclass so a partial replay is a no-op.
DO $$
BEGIN
  IF to_regclass('public.crypto_onchain_balances') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.crypto_onchain_balances ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS crypto_onchain_balances_admin ON public.crypto_onchain_balances';
    EXECUTE 'CREATE POLICY crypto_onchain_balances_admin ON public.crypto_onchain_balances FOR SELECT USING (public.is_admin())';

    EXECUTE 'DROP POLICY IF EXISTS crypto_onchain_balances_service ON public.crypto_onchain_balances';
    EXECUTE 'CREATE POLICY crypto_onchain_balances_service ON public.crypto_onchain_balances FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')';
  END IF;
END $$;

COMMIT;
