-- Migration: admin_payments_finance_stats RPC
-- Additive only — creates a new function, no changes to existing tables.
--
-- WAL-013: frontend-web/app/api/admin/payments-finance/route.ts computed its
-- `stats` block (totalBalanceKobo, creditVolumeKobo, debitVolumeKobo) by
-- summing whatever fit in a `limit: 50` page of wallet_balance / ledger_entries
-- ordered by recency. That silently understates every figure once the
-- platform has more than 50 active wallets or more than 50 recent ledger
-- entries, and drifts further as it grows. There was also no "active
-- wallets" metric at all (confirmed absent by grep across frontend-admin,
-- frontend-web and backend/internal/finance).
--
-- This function computes all four stats as real, unbounded aggregates in
-- the database instead of summing a capped row window client-side:
--   - total_balance_kobo:   SUM(available_kobo) over ALL customer wallets
--                            (via the wallet_balance view — the existing
--                            ledger projection, never a stored balance
--                            column per the wallet module's own rule).
--   - credit/debit_volume:  SUM(amount_kobo) over ledger_entries in a
--                            bounded recent window, not "last 50 rows
--                            regardless of age".
--   - active_wallets_count: COUNT(DISTINCT account_id) with >=1 ledger
--                            movement in that SAME window. No prior
--                            definition of "active wallet" exists anywhere
--                            in the codebase (grepped ledger/wallet/finance
--                            modules) to reuse, so this picks the simplest
--                            one that is consistent with the volume figures
--                            it sits next to on the same dashboard, rather
--                            than inventing a second, differently-windowed
--                            concept of "active".
--
-- Window default: 30 days. Arbitrary but conventional for a rolling
-- "recent activity" figure on an admin dashboard; the caller passes it
-- explicitly (p_window_start) so the route owns the definition.
--
-- Exclusion of platform pot accounts (settlement, provider_clearing,
-- paymax_revenue, escrow, ...) is preserved exactly as the route already
-- computes it — p_customer_account_types and p_excluded_account_ids are
-- passed in from the SAME CUSTOMER_ACCOUNT_TYPES / platformAccountIds the
-- route already builds; this function does not redefine that policy.
--
-- SECURITY INVOKER (default, no SECURITY DEFINER): the only caller is the
-- admin route's service-role client, which already bypasses RLS on the
-- underlying tables — no need to escalate privileges for anon/authenticated,
-- and EXECUTE is restricted to service_role below.

CREATE OR REPLACE FUNCTION public.admin_payments_finance_stats(
  p_customer_account_types TEXT[],
  p_excluded_account_ids UUID[],
  p_window_start TIMESTAMPTZ
)
RETURNS TABLE (
  total_balance_kobo BIGINT,
  credit_volume_kobo BIGINT,
  debit_volume_kobo BIGINT,
  active_wallets_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  WITH customer_wallets AS (
    SELECT id AS account_id
    FROM public.ledger_accounts
    WHERE type = ANY(p_customer_account_types)
      AND NOT (id = ANY(p_excluded_account_ids))
  ),
  windowed_entries AS (
    SELECT le.type, le.amount_kobo, le.account_id
    FROM public.ledger_entries le
    JOIN customer_wallets cw ON cw.account_id = le.account_id
    WHERE le.created_at >= p_window_start
  )
  SELECT
    (
      SELECT COALESCE(SUM(wb.available_kobo), 0)::BIGINT
      FROM public.wallet_balance wb
      WHERE wb.account_id IN (SELECT account_id FROM customer_wallets)
    ) AS total_balance_kobo,
    (
      SELECT COALESCE(SUM(amount_kobo), 0)::BIGINT
      FROM windowed_entries WHERE type = 'CREDIT'
    ) AS credit_volume_kobo,
    (
      SELECT COALESCE(SUM(amount_kobo), 0)::BIGINT
      FROM windowed_entries WHERE type = 'DEBIT'
    ) AS debit_volume_kobo,
    (
      SELECT COUNT(DISTINCT account_id)
      FROM windowed_entries
    ) AS active_wallets_count;
$$;

REVOKE ALL ON FUNCTION public.admin_payments_finance_stats(TEXT[], UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payments_finance_stats(TEXT[], UUID[], TIMESTAMPTZ) TO service_role;
