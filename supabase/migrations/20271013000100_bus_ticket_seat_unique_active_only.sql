-- ┌────────────────────────────────────────────────────────────────────────────┐
-- │ USER-APPROVED EXCEPTION to the additive-only migration rule (CLAUDE.md).   │
-- │ ADR-PR559-bus-wallet-fixes. Kept in its OWN file so reviewers can drop it │
-- │ from the PR without touching the other bus migration.                      │
-- └────────────────────────────────────────────────────────────────────────────┘
-- Problem: bus_tickets had UNIQUE(schedule_id, seat_number) over ALL rows, but the
-- seat map and seats-left counts treat cancelled/refunded tickets as FREE. A
-- cancelled seat was shown bookable and then every INSERT hit the unique
-- violation, so a cancelled seat could never be re-sold.
-- Fix: drop that constraint and enforce uniqueness over ACTIVE tickets only.
-- "Active" = status NOT IN ('cancelled','refunded') - the exact predicate the seat
-- map (BusSeatMap), ListBusSchedules and SearchBusTrips already use. (payment_status
-- only has 'paid'/'refunded' and is set together with status, so status is the
-- authoritative column.)
--
-- Ordering (no unprotected window): the new partial unique index is created FIRST,
-- then the old constraint is dropped. While both exist the old (stricter) constraint
-- still protects every seat, so even on a NON-transactional runner (plain `psql -f`)
-- there is never a moment without seat uniqueness.
-- Locking: CREATE UNIQUE INDEX (not CONCURRENTLY - that cannot run in a migration
-- transaction) takes a SHARE lock on bus_tickets for the duration of the build,
-- blocking writes (not reads) to that table. bus_tickets is small (one row per seat
-- sold) so the build is sub-second; run it in a quiet moment on a very large table.
-- Idempotent: the index is IF NOT EXISTS; the constraint is located by its column set
-- (not by an assumed auto-generated name) and dropped only if present.
-- Safe on existing data: the old constraint was strictly stronger than the new
-- index, so no duplicate-active rows can exist.
CREATE UNIQUE INDEX IF NOT EXISTS bus_tickets_schedule_seat_active_uidx
    ON public.bus_tickets (schedule_id, seat_number)
    WHERE status NOT IN ('cancelled','refunded');

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = rel.relnamespace
        WHERE ns.nspname = 'public' AND rel.relname = 'bus_tickets' AND con.contype = 'u'
          AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
                 FROM unnest(con.conkey) k
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
              = ARRAY['schedule_id','seat_number']
    LOOP
        EXECUTE format('ALTER TABLE public.bus_tickets DROP CONSTRAINT IF EXISTS %I', c.conname);
    END LOOP;
END $$;
