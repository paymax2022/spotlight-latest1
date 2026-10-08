-- Migration: ledger read-path indexes (AGT1-PERF-003)
-- Additive only — CREATE INDEX IF NOT EXISTS on an existing table. No drops,
-- no renames, no type changes.
--
-- Why: the wallet balance read path (GET /api/finance/wallet/balance,
-- GET /api/v1/wallet/summary, admin balance views) projects a balance as
--   SELECT COALESCE(SUM(CASE WHEN type IN ('CREDIT','REVERSAL_DEBIT')
--                            THEN amount_kobo ELSE -amount_kobo END), 0)
--   FROM ledger_entries WHERE account_id = $1
-- Today that runs a bitmap heap scan over idx_ledger_entries_account_id and
-- heap-fetches EVERY row the account owns. The covering index below carries
-- exactly the columns the projection reads (type, amount_kobo), so Postgres can
-- answer the SUM as an index-only scan once the visibility map settles.
-- The win grows with account size — most valuable on standing accounts
-- (provider_clearing, commission, settlement …) which accumulate every money
-- movement in the system, unbounded.
--
-- The transaction-history read (WHERE account_id ORDER BY created_at DESC
-- LIMIT n) index-scans account_id then sorts the full matching set; the second
-- index serves the ordering natively so a LIMIT page touches only n index rows.

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_balance_cover
  ON public.ledger_entries (account_id) INCLUDE (type, amount_kobo);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_created
  ON public.ledger_entries (account_id, created_at DESC);
