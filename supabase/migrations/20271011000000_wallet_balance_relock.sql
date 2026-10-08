-- Re-lock public.wallet_balance and fail loudly if the lock does not hold.
--
-- Context: 20271008000000 set security_invoker=true and revoked anon/PUBLIC.
-- Hours after it was applied and verified live (anon -> 42501), production
-- started returning rows to the anon role again (HTTP 200). The two revoked
-- money RPCs stayed denied, so this was not a grant-drift on the function
-- side — it is the signature of the VIEW BEING RECREATED: a fresh CREATE VIEW
-- receives the Supabase platform default privileges (SELECT -> anon +
-- authenticated) and loses reloptions, so the view reverts to definer-rights
-- and bypasses ledger_accounts/ledger_entries RLS entirely.
--
-- This migration:
--   1. Re-applies the invoker-security posture (idempotent, same projection).
--   2. Revokes every grant then restores the intended ACL.
--   3. ASSERTS the posture inside the same transaction — if anything
--      re-creates or re-grants the view between now and a future push, the
--      assertion in THIS file still guards today's state; the regression
--      sentinel is the post-push PostgREST probe (see comment at bottom).
--   4. Asks PostgREST to reload its schema cache so a stale cached ACL
--      cannot outlive the fix.
--
-- Additive-only: CREATE OR REPLACE / ALTER / REVOKE / GRANT — nothing dropped.

BEGIN;

CREATE OR REPLACE VIEW public.wallet_balance
WITH (security_invoker = true) AS
SELECT
  la.id          AS account_id,
  la.user_id,
  la.type        AS account_type,
  la.currency,
  COALESCE(
    SUM(
      CASE
        WHEN le.type IN ('CREDIT', 'REVERSAL_DEBIT') THEN  le.amount_kobo
        WHEN le.type IN ('DEBIT', 'REVERSAL_CREDIT') THEN -le.amount_kobo
        ELSE 0
      END
    ),
    0
  ) AS available_kobo,
  MAX(le.created_at) AS last_transaction_at
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le ON le.account_id = la.id
GROUP BY la.id, la.user_id, la.type, la.currency;

-- Belt: CREATE OR REPLACE normally rewrites reloptions, but set it explicitly
-- so the option is guaranteed regardless of how the view was (re)created.
ALTER VIEW public.wallet_balance SET (security_invoker = true);

COMMENT ON VIEW public.wallet_balance IS
  'Ledger-projection of per-account available balance (kobo). '
  'security_invoker = true since 20271008000000 — callers see only rows their '
  'RLS on ledger_accounts/ledger_entries admits. Never a stored balance column. '
  'Re-locked by 20271011000000 after a recreate re-exposed it to anon.';

REVOKE ALL ON public.wallet_balance FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.wallet_balance FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.wallet_balance FROM authenticated';
    EXECUTE 'GRANT SELECT ON public.wallet_balance TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON public.wallet_balance TO service_role';
  END IF;

  -- Fail the migration (and the push) if the lock did not land. Checking
  -- inside the same transaction means a push that leaves the view exposed
  -- reports FAILURE instead of a green run that silently leaks balances.
  -- has_table_privilege includes PUBLIC grants when checking a named role,
  -- so this single check covers both channels.
  IF has_table_privilege('anon', 'public.wallet_balance', 'SELECT') THEN
    RAISE EXCEPTION 'wallet_balance still readable by anon/PUBLIC after relock';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'wallet_balance'
      AND c.relkind = 'v'
      AND c.reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'wallet_balance missing security_invoker=true after relock';
  END IF;
END;
$$;

-- Flush the PostgREST schema cache so the revoked ACL takes effect on the API
-- immediately rather than on the next reload tick.
NOTIFY pgrst, 'reload schema';

COMMIT;
