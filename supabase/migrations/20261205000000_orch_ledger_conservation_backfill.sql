-- Migration: close the historical per-currency conservation gap in
-- public.orch_ledger_entries, and expose an ops/CI probe for it.
-- ADR-029 (docs/adr/ADR-029-orch-ledger-per-currency-double-entry.md).
--
-- WHY
-- ---
-- ADR-029 fixed the WRITERS: ApplyConversion now posts five legs so both
-- currencies balance, and ApplyTransfer posts three instead of a lone DEBIT.
-- But every conversion written BEFORE that is still single-sided per currency —
-- a `customer_balance` DEBIT in the source currency with no source-currency
-- counter-leg, and a `customer_balance` CREDIT in the destination currency with
-- no destination-currency counter-leg. Destination money was created from
-- nothing.
--
-- Observed on the local QA database (2026-08-13), four legacy conversions:
--
--     currency | debits |  credits  |  residual
--     ---------+--------+-----------+------------
--     NGN      |      0 | 106669225 | -106669225
--     USD      | 447668 |    380000 |      67668
--
-- While those rows exist, per-currency conservation cannot be asserted over the
-- table at all, so a future single-sided writer would be invisible under the
-- noise. ADR-029's own tests are scoped to synthetic customers precisely because
-- the whole-table assertion could not pass; this migration makes it passable and
-- adds the probe.
--
-- WHAT THIS DOES
-- --------------
-- For every (customer_id, reference, currency) group that does not net to zero,
-- it posts ONE reconstructed leg on `provider_clearing` for the residual. That
-- is not an arbitrary plug: it is EXACTLY the leg the fixed ApplyConversion now
-- writes —
--
--     source currency: CR provider_clearing (sourceTotal - spread)
--     dest currency:   DR provider_clearing (destAmount)
--
-- — with the spread taken as 0, which is the same degradation `splitSpread`
-- already applies when a spread is absent or nonsensical. The retained FX markup
-- of a historical conversion is not recoverable after the fact, and attributing
-- it to `paymax_spread` by guesswork would overstate revenue; leaving the whole
-- amount in `provider_clearing` understates nothing and keeps the currency
-- balanced, which is the property being restored.
--
-- SAFETY
-- ------
--  • INSERT-only. No existing row is modified or deleted.
--  • No DDL on any existing table — the `account` column has no CHECK
--    constraint, and `provider_clearing` is already part of the vocabulary
--    documented in the table's own schema comment
--    (20260621000000_fx_orchestration.sql:19) and already written by
--    cards_store.go. No migration was needed for ADR-029's code fix and none is
--    needed for its accounts here.
--  • `orch_balances` is NOT touched. The ledger is the audit trail; customer
--    spendable balances were already correct (they are maintained by the same
--    transactions that wrote the lopsided entries), and rewriting them would
--    change real money.
--  • Balanced pairs the card path wrote (`cards_store.go`, DR customer_balance /
--    CR card_balance in ONE currency) net to zero and are left untouched.
--  • Idempotent: the reconstructed leg's key carries the residual it closes, so
--    a plain re-run finds no unbalanced groups and does nothing, while a gap
--    re-opening at a different amount still gets its own leg.
--  • On a fresh database (`supabase db reset`) there is nothing to backfill and
--    this is a no-op.
--
-- ⚠ DEPLOY ORDER: must land WITH OR AFTER the Go build carrying ADR-029
-- (backend/internal/orchestration/repository.go). If the old single-sided
-- ApplyConversion is still running, it re-opens the gap this closes.
--
-- ⚠ MONEY-PATH: requires ledger-auditor review before merge.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Reconstruct one provider_clearing leg per unbalanced (customer, reference,
--    currency) group.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_groups BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_groups
    FROM (
      SELECT customer_id, reference, currency
        FROM public.orch_ledger_entries
       GROUP BY customer_id, reference, currency
      HAVING COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0)
           - COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) <> 0
    ) unbalanced;

  IF v_groups = 0 THEN
    RAISE NOTICE 'ADR-029 orch backfill: ledger already conserves per currency — nothing to do.';
    RETURN;
  END IF;

  RAISE NOTICE 'ADR-029 orch backfill: reconstructing legs for % unbalanced (customer, reference, currency) group(s).', v_groups;

  INSERT INTO public.orch_ledger_entries
    (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
  SELECT
    u.customer_id,
    'provider_clearing',
    u.currency,
    -- Residual > 0 means the group carries excess DEBIT weight, so the missing
    -- leg was the CREDIT side (the source-currency clearing leg), and vice-versa
    -- for the destination currency.
    CASE WHEN u.residual > 0 THEN 'CREDIT' ELSE 'DEBIT' END,
    ABS(u.residual),
    u.reference,
    'adr029-backfill:' || u.customer_id || ':' || u.reference || ':' || u.currency || ':' || u.residual
  FROM (
    SELECT customer_id, reference, currency,
           COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0)
         - COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) AS residual
      FROM public.orch_ledger_entries
     GROUP BY customer_id, reference, currency
    HAVING COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0)
         - COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) <> 0
  ) u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.orch_ledger_entries e
     WHERE e.idempotency_key =
       'adr029-backfill:' || u.customer_id || ':' || u.reference || ':' || u.currency || ':' || u.residual
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) Conservation probe
-- ---------------------------------------------------------------------------
-- One row per currency. Every residual_minor MUST be 0 — a non-zero value means
-- some writer posted a leg with no counter-leg IN THE SAME CURRENCY. Currency is
-- part of the grouping deliberately: a currency-blind debit-vs-credit check
-- passes outright whenever the FX rate happens to be 1, which is exactly how the
-- original defect hid.
--
-- security_invoker so the view cannot become an RLS bypass, and grants revoked
-- from anon/authenticated — a platform-wide FX position is not public data.
CREATE OR REPLACE VIEW public.orch_ledger_conservation_check
WITH (security_invoker = true) AS
SELECT
  currency,
  COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0) AS debit_minor,
  COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) AS credit_minor,
  COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0)
    - COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) AS residual_minor,
  COUNT(*) AS entry_count
FROM public.orch_ledger_entries
GROUP BY currency;

COMMENT ON VIEW public.orch_ledger_conservation_check IS
  'ADR-029 per-currency conservation probe over orch_ledger_entries. Every '
  'residual_minor MUST be 0 — any other value means a writer posted a leg with no '
  'counter-leg in the same currency. Backend/service_role only.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.orch_ledger_conservation_check FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.orch_ledger_conservation_check FROM authenticated';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Verify conservation before committing.
-- ---------------------------------------------------------------------------
-- Projected directly rather than through the view, which is security_invoker and
-- would be filtered under a non-owner migration role — reading it here could
-- pass vacuously.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(currency || '=' || residual, ', ')
    INTO v_bad
    FROM (
      SELECT currency,
             COALESCE(SUM(amount_minor) FILTER (WHERE type = 'DEBIT'),  0)
           - COALESCE(SUM(amount_minor) FILTER (WHERE type = 'CREDIT'), 0) AS residual
        FROM public.orch_ledger_entries
       GROUP BY currency
    ) per_currency
   WHERE residual <> 0;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-029 orch backfill did not reach per-currency conservation: %. '
      'A single-sided writer is probably still deployed — see the DEPLOY ORDER note at the top.',
      v_bad;
  END IF;
END;
$$;

COMMIT;
