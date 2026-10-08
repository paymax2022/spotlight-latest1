-- Enforce referral_events immutability in the DATABASE, not just in service code.
--
-- WHY (REF-010)
-- referral_events is System C's audit trail for the Next.js vote-bridge referral
-- reward (frontend-web/src/server/referrals/service.ts). Like ledger_entries, it
-- is meant to be an append-only record — one row per successful referral reward,
-- created once via idempotency_key and never edited afterward. Unlike
-- ledger_entries, nothing enforced that: `SELECT tgname FROM pg_trigger WHERE
-- tgrelid = 'referral_events'::regclass AND NOT tgisinternal;` returned zero rows.
-- The service-role key bypasses RLS entirely, so any script, migration, psql
-- session or PostgREST call holding that key could silently rewrite or erase
-- referral reward history, the same class of gap ledger_entries had before
-- 20270192000000_ledger_entries_immutable.sql closed it there.
--
-- WHY A NEW FUNCTION INSTEAD OF REUSING public.ledger_entries_immutable()
-- That function's RAISE EXCEPTION message and COMMENT ON FUNCTION are both
-- hardcoded to the string "ledger_entries" — it is not a generic, table-agnostic
-- guard, so reusing it here would print a misleading error naming the wrong
-- table. This migration defines an equivalent function scoped to referral_events,
-- following the exact same pattern (BEFORE UPDATE/DELETE row trigger + BEFORE
-- TRUNCATE statement trigger, RAISE EXCEPTION with ERRCODE = 'restrict_violation').
--
-- SCOPE — referral_events ONLY. No other table is touched.
--
-- WHAT THIS DOES NOT CLAIM
-- A table owner or superuser can still ALTER TABLE ... DISABLE TRIGGER, and
-- session_replication_role = 'replica' bypasses triggers entirely. Same seatbelt,
-- not vault, caveat as the ledger_entries migration.
--
-- SAFETY: additive-only per CLAUDE.md. Creates one function and two triggers.
-- The DROP TRIGGER IF EXISTS lines are the idempotent re-create pattern
-- explicitly allowed by .github/workflows/_reusable-migration-guard.yml; they
-- drop only the triggers this migration itself creates. No table, column, type
-- or constraint is dropped, renamed or narrowed. Re-runnable.

BEGIN;

CREATE OR REPLACE FUNCTION public.referral_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'referral_events is append-only: % is not permitted on a posted referral reward',
        TG_OP
      USING
        HINT   = 'Referral rewards are recorded once via idempotency_key and never '
                 'edited or removed — this is an audit trail, not a mutable record.',
        ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION public.referral_events_immutable() IS
    'Refuses UPDATE/DELETE/TRUNCATE on referral_events. It is the audit trail for '
    'the referral reward path, so an edit would rewrite reward history with no trace.';

-- Row-level: blocks UPDATE and DELETE.
DROP TRIGGER IF EXISTS referral_events_no_update_delete ON public.referral_events;
CREATE TRIGGER referral_events_no_update_delete
    BEFORE UPDATE OR DELETE ON public.referral_events
    FOR EACH ROW EXECUTE FUNCTION public.referral_events_immutable();

-- Statement-level: TRUNCATE fires no row triggers, so it needs its own.
DROP TRIGGER IF EXISTS referral_events_no_truncate ON public.referral_events;
CREATE TRIGGER referral_events_no_truncate
    BEFORE TRUNCATE ON public.referral_events
    FOR EACH STATEMENT EXECUTE FUNCTION public.referral_events_immutable();

COMMIT;
