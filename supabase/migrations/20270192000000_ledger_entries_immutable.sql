-- Enforce ledger immutability in the DATABASE, not just in service code.
--
-- WHY
-- CLAUDE.md states the iron rule: "Ledger entries are immutable. Corrections =
-- reversing entries only." Until now that was enforced only by convention — the
-- Go ledger service simply never issues an UPDATE or DELETE. Nothing stopped
-- anything else from doing so, and the service-role key bypasses RLS entirely,
-- so any script, migration, psql session or PostgREST call holding that key
-- could silently rewrite or erase the ledger of record.
--
-- This was not hypothetical: on 2026-08-26 a PATCH through PostgREST successfully
-- UPDATEd a posted ledger_entries row on the staging project. The write was a
-- correction to an idempotency key, not a change of financial substance, but the
-- point stands — the ledger accepted it, and nothing objected.
--
-- A ledger whose rows can be edited is not a ledger. Balances are projections
-- over these rows (balanceProjectionSQL sums CREDIT/REVERSAL_DEBIT as +, and
-- DEBIT/REVERSAL_CREDIT as -), so a single silent UPDATE moves money with no
-- audit trail and no reversing entry to explain it.
--
-- SCOPE — ledger_entries ONLY, deliberately.
-- A repo-wide search found NOTHING that updates or deletes ledger_entries, so
-- this locks it down at zero cost to existing code. The sibling FX ledger,
-- orch_ledger_entries, is NOT covered here: two live-DB suites
-- (backend/tests/fx/cards_funding_live_db_test.go and
-- orch_ledger_invariants_live_db_test.go) DELETE from it to clean up fixtures,
-- and a blanket block would break them. Hardening that table needs those tests
-- moved onto a disposable schema or a scoped exception first — worth doing, but
-- not silently bundled in here.
--
-- WHAT THIS DOES NOT CLAIM
-- A table owner or superuser can still ALTER TABLE ... DISABLE TRIGGER, and
-- session_replication_role = 'replica' bypasses triggers entirely. This raises
-- the floor from "nothing stops you" to "you must disable a guard whose name
-- says what you are doing", which is greppable in review and impossible to do by
-- accident. It is a seatbelt, not a vault.
--
-- IF YOU NEED TO CHANGE A POSTED ENTRY: you do not. Post a reversing pair
-- (REVERSAL_DEBIT / REVERSAL_CREDIT via ledger.PostReversalPair) and, if needed,
-- a fresh correct entry. That is what leaves an auditable trail.
--
-- SAFETY: additive-only per CLAUDE.md. Creates one function and two triggers.
-- The DROP TRIGGER IF EXISTS lines are the idempotent re-create pattern
-- explicitly allowed by .github/workflows/_reusable-migration-guard.yml; they
-- drop only the triggers this migration itself creates. No table, column, type
-- or constraint is dropped, renamed or narrowed. Re-runnable.

BEGIN;

CREATE OR REPLACE FUNCTION public.ledger_entries_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'ledger_entries is append-only: % is not permitted on a posted entry',
        TG_OP
      USING
        HINT   = 'Corrections are reversing entries only — post a REVERSAL_DEBIT / '
                 'REVERSAL_CREDIT pair (ledger.PostReversalPair), never edit or delete history.',
        ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION public.ledger_entries_immutable() IS
    'Refuses UPDATE/DELETE/TRUNCATE on ledger_entries. Balances are projections '
    'over these rows, so an edit moves money with no reversing entry to explain it.';

-- Row-level: blocks UPDATE and DELETE.
DROP TRIGGER IF EXISTS ledger_entries_no_update_delete ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_update_delete
    BEFORE UPDATE OR DELETE ON public.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_immutable();

-- Statement-level: TRUNCATE fires no row triggers, so it needs its own.
-- Without this the whole ledger could still be erased in one statement.
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate
    BEFORE TRUNCATE ON public.ledger_entries
    FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_entries_immutable();

COMMIT;
