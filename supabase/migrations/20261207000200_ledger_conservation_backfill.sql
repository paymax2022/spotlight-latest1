-- Migration: close the historical conservation gap in public.ledger_entries,
-- and expose a first-class way to assert conservation from tests/ops.
-- ADR-PR98 (docs/adr/ADR-PR98-wallet-plane-double-entry.md).
--
-- ⚠ DEPLOY ORDER: this migration must land WITH OR AFTER the frontend-web build
-- that contains ADR-PR98 (frontend-web/src/server/wallet/journal.ts). If the old
-- single-leg `creditWallet` is still serving when this runs, it keeps writing
-- bare CREDITs and re-opens the gap this closes. Backfilling a still-single-sided
-- writer is pointless, not dangerous — but the conservation assertion at the end
-- can then fail on a later replay of this file in another environment.
--
-- WHY
-- ---
-- 20261207000000 (and the app-side journal helper) stop NEW single-sided writes.
-- But every event the Next.js wallet plane posted BEFORE that is still a lone
-- leg on the shared table — e.g. the observed local-DB row
-- `TOPUP:TOPUP_C2379AC8A0474D06`, CREDIT 500000, with no offsetting DEBIT — so
-- `SUM(signed) = 0` would still fail on any database carrying that history and
-- the CI invariant could never be switched on for existing environments.
--
-- WHAT THIS DOES
-- --------------
-- For every `reference` whose entries do not already net to zero, it posts ONE
-- reconstructed contra-leg for the residual onto a dedicated standing account,
-- `legacy_wallet_contra` (admitted by 20261207000100). After this runs, every
-- reference group nets to zero, and therefore so does the table.
--
-- SAFETY
-- ------
--  • INSERT-only. No existing row is modified or deleted — the ledger stays
--    immutable, exactly as the base migration promised (corrections are entries).
--  • Touches only ledger_entries; the ACCESS EXCLUSIVE DDL was split into its own
--    migration so this scan does not block wallet reads/writes.
--  • No USER balance changes: contra-legs land on a STANDING account
--    (user_id IS NULL), which no user's balance projection reads.
--  • Groups the Go finance plane wrote are already balanced, so they produce no
--    residual and are left untouched.
--  • A dedicated account type (rather than reusing `settlement` or
--    `provider_clearing`) quarantines RECONSTRUCTED legs from observed ones, so
--    finance reporting can exclude them and their total is the exact size of the
--    pre-ADR-PR98 gap.
--  • Idempotent: the contra-leg key carries the residual it closes, so a plain
--    re-run finds no unbalanced groups and does nothing, while a gap that
--    re-opens at a DIFFERENT amount still gets its own leg. A gap that re-opens
--    at the IDENTICAL amount is skipped and then caught by the assertion at the
--    end — loudly, rather than silently.
--  • On a fresh database (`supabase db reset`) there is nothing to backfill and
--    this is a no-op.
--
-- ⚠ MONEY-PATH: requires ledger-auditor review before merge.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Post one reconstructed contra-leg per unbalanced reference group.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_contra_id UUID;
  v_groups    BIGINT;
  v_residual  BIGINT;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(signed), 0)
    INTO v_groups, v_residual
    FROM (
      SELECT reference,
             SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                      ELSE -amount_kobo END) AS signed
        FROM public.ledger_entries
       GROUP BY reference
      HAVING SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                      ELSE -amount_kobo END) <> 0
    ) unbalanced;

  IF v_groups = 0 THEN
    RAISE NOTICE 'ADR-PR98 backfill: ledger already conserves — nothing to do.';
    RETURN;
  END IF;

  RAISE NOTICE 'ADR-PR98 backfill: % unbalanced reference group(s), net residual % kobo.',
    v_groups, v_residual;

  v_contra_id := public.ledger_standing_account('legacy_wallet_contra');

  INSERT INTO public.ledger_entries
    (account_id, type, amount_kobo, reference, idempotency_key, description, metadata)
  SELECT
    v_contra_id,
    -- Residual > 0 means the group carries excess CREDIT weight, so the missing
    -- leg was a DEBIT (and vice-versa).
    CASE WHEN u.signed > 0 THEN 'DEBIT' ELSE 'CREDIT' END,
    ABS(u.signed),
    u.reference,
    -- The residual is part of the key: re-running is a no-op, but a gap that
    -- re-opens at a different amount still gets its own reconstructed leg.
    'wallet-conservation-backfill:' || u.reference || ':' || u.signed,
    'ADR-PR98 reconstructed contra-leg for pre-double-entry wallet history',
    jsonb_build_object(
      'adr', 'ADR-PR98',
      'kind', 'conservation_backfill',
      'residual_kobo', u.signed
    )
  FROM (
    SELECT reference,
           SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                    ELSE -amount_kobo END) AS signed
      FROM public.ledger_entries
     GROUP BY reference
    HAVING SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                    ELSE -amount_kobo END) <> 0
  ) u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.ledger_entries e
     WHERE e.idempotency_key = 'wallet-conservation-backfill:' || u.reference || ':' || u.signed
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Conservation check surface
-- ---------------------------------------------------------------------------
-- One row, one number: the signed sum over the WHOLE shared table. It must be 0.
-- Used by the live-DB invariant test and available to ops for a one-line audit.
--
-- security_invoker so the view cannot become an RLS bypass: ledger_entries has
-- RLS with a select-own policy, and a definer-rights view over it would let any
-- caller read a platform-wide aggregate. Belt AND braces — the grants are also
-- revoked below.
CREATE OR REPLACE VIEW public.ledger_conservation_check
WITH (security_invoker = true) AS
SELECT
  COALESCE(SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                    ELSE -amount_kobo END), 0) AS residual_kobo,
  COUNT(*)                                     AS entry_count
FROM public.ledger_entries;

COMMENT ON VIEW public.ledger_conservation_check IS
  'ADR-PR98 global conservation probe over the shared ledger_entries table. '
  'residual_kobo MUST be 0 — any other value means some writer posted a '
  'single-sided (or otherwise unbalanced) entry. Backend/service_role only.';

-- Supabase grants SELECT on new public relations to anon/authenticated by
-- default; a platform-wide ledger aggregate is not for them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.ledger_conservation_check FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.ledger_conservation_check FROM authenticated';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Verify the backfill actually achieved conservation before committing.
-- ---------------------------------------------------------------------------
-- Projected directly (not through the view, which is security_invoker and would
-- be filtered under a non-superuser migration role).
DO $$
DECLARE
  v_residual BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN type IN ('CREDIT', 'REVERSAL_DEBIT') THEN amount_kobo
                           ELSE -amount_kobo END), 0)
    INTO v_residual
    FROM public.ledger_entries;

  IF v_residual <> 0 THEN
    RAISE EXCEPTION 'ADR-PR98 backfill did not reach conservation: residual=% kobo. '
      'A single-sided writer is probably still deployed — see the DEPLOY ORDER note at the top.',
      v_residual;
  END IF;
END;
$$;

COMMIT;
