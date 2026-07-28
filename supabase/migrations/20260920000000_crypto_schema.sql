-- Paymax × Spotlight — Crypto schema completeness + withdrawal AML review gate.
--
-- SCOPE / WHY THIS MIGRATION EXISTS
-- A QA audit (docs/qa/journeys.md, Journey 7) reported that NO migration creates the
-- crypto_* tables the backend queries. On review that finding is STALE: every crypto
-- table the repo code selects/inserts/updates is in fact already created by earlier
-- additive migrations:
--
--   20260815001600_crypto.sql
--     → crypto_assets, crypto_orders, crypto_holdings,
--       crypto_price_snapshots, crypto_audit_log   (+ RBAC crypto.view/trade/admin)
--   20260901001200_crypto_swap_withdrawal_addresses.sql
--     → crypto_swap_orders, crypto_addresses, crypto_deposit_addresses,
--       crypto_withdrawals, crypto_withdrawal_events
--   20260919000500_crypto_onchain_balances.sql
--     → crypto_onchain_balances
--
-- So this migration does NOT recreate any table (doing so would duplicate). It makes
-- the ONE genuinely-required schema change for the withdrawal AML review gate: it
-- WIDENS crypto_withdrawals.status to allow the new 'pending_review' and 'approved'
-- states in the corrected state machine
--
--   requested → pending_review → approved → broadcast → confirmed | failed
--            (+ pending_review → failed on reject; + approved → failed on provider reject)
--
-- The member create path now STOPS at pending_review (units parked/held, provider
-- never called); a compliance officer must approve (pending_review → approved) before
-- the broadcast fires — no money leaves before AML review.
--
-- ADDITIVE / SAFE: this only WIDENS the allowed status set (adds two legal values); it
-- narrows nothing and drops no table/column/data. Replacing a CHECK constraint with a
-- strictly-broader one keeps every existing row valid. Guarded with to_regclass so a
-- partial/absent-table replay is a no-op. No DROP TABLE, no column rename, no type
-- change. All monetary amounts remain integer minor units.
BEGIN;

-- ── Widen crypto_withdrawals.status to include the AML review-gate states ──────
-- The original CHECK (20260901001200) allowed only
--   ('requested','pending','broadcast','confirmed','failed').
-- The corrected FSM adds 'pending_review' (parked, awaiting AML) and 'approved'
-- (AML-cleared, pre-broadcast). We keep the legacy 'pending' value in the allowed
-- set too so any historical rows remain valid (additive; narrows nothing).
DO $$
DECLARE
  conname text;
BEGIN
  IF to_regclass('public.crypto_withdrawals') IS NULL THEN
    RAISE NOTICE 'crypto_withdrawals not present — skipping status CHECK widening';
    RETURN;
  END IF;

  -- Drop whatever CHECK constraint currently bounds status (name may be
  -- auto-generated), then re-add the widened one. This is a widening replace:
  -- every value previously legal is still legal, plus the two new states.
  FOR conname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'crypto_withdrawals'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.crypto_withdrawals DROP CONSTRAINT %I', conname);
  END LOOP;

  -- Idempotent add: only create the widened constraint if it is not already present.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'crypto_withdrawals'
      AND con.conname = 'crypto_withdrawals_status_check_v2'
  ) THEN
    ALTER TABLE public.crypto_withdrawals
      ADD CONSTRAINT crypto_withdrawals_status_check_v2
      CHECK (status IN (
        'requested',
        'pending_review',  -- parked/held, awaiting admin AML review (NOT sent)
        'approved',        -- AML-cleared; broadcast may now fire
        'pending',         -- legacy value retained so historical rows stay valid
        'broadcast',
        'confirmed',
        'failed'
      ));
  END IF;
END $$;

-- Note on the other crypto_* tables: intentionally NOT (re)created here. They are
-- owned by the migrations listed in the header and are additive/present already;
-- recreating them would duplicate schema. Their RLS backend-only lockdown
-- (service_role writes; is_admin() reads for the console) is likewise already in
-- place in those migrations.

COMMIT;
