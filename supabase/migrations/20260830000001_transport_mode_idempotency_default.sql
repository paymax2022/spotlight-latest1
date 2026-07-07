-- Paymax Mobility — additive idempotency hardening for the 7 mode tables.
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing, no NOT NULL flip.
--
-- Follow-up to 20260624000000_transport_modes.sql and
-- 20260625000500_transport_logistics_event.sql. Closes audit finding #15
-- (PRODUCTION-READINESS-AUDIT.md): the mode tables — parcels, bus_tickets,
-- towing_jobs, mover_jobs, car_hire_bookings, business_deliveries,
-- event_transport_bookings — carry `idempotency_key TEXT UNIQUE` NULLABLE. A NULL
-- key is exempt from the UNIQUE constraint, so an insert that omits the key bypasses
-- the replay guard entirely (two double-taps → two rows → two escrows).
--
-- Forcing the column NOT NULL is NON-ADDITIVE: pre-existing rows may hold NULLs and
-- a NOT NULL flip is a data-breaking narrowing (see the additive-safety note in
-- 20260710000000_transport_dispatch_geo_and_shares.sql). Instead we install a
-- BEFORE INSERT trigger per mode table that DEFAULTS a NULL idempotency_key to
-- gen_random_uuid()::text. Result:
--   • every inserted row now carries a unique guard value (no more NULL bypass);
--   • a genuine client-supplied key is left untouched, so real replays still dedupe
--     on the existing UNIQUE constraint;
--   • the column stays nullable at the schema level → fully additive (adds one
--     function + one trigger per table; touches no existing column type/nullability;
--     never rewrites existing rows).
--
-- The trigger fires only on INSERT (never UPDATE), so it can never mutate an
-- already-committed guard value.

-- ─── Shared trigger function ──────────────────────────────────────────────────
-- One function, reused by every mode table. IF NULL → assign a fresh UUID string;
-- otherwise pass the client key through unchanged. gen_random_uuid() is provided by
-- pgcrypto/pg_catalog (already used as the DEFAULT for every mode table's PK), so no
-- new extension is required.
CREATE OR REPLACE FUNCTION transport_default_idempotency_key() RETURNS trigger AS $$
BEGIN
    IF NEW.idempotency_key IS NULL THEN
        NEW.idempotency_key := gen_random_uuid()::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Per-table BEFORE INSERT triggers ─────────────────────────────────────────
-- DROP TRIGGER IF EXISTS … before CREATE keeps this migration idempotent/re-runnable
-- (matches the drivers_sync_geog_trg pattern in 20260710000000). Each trigger is
-- scoped to its own table so the guard is explicit and independently auditable.

DROP TRIGGER IF EXISTS parcels_default_idem_trg ON parcels;
CREATE TRIGGER parcels_default_idem_trg
    BEFORE INSERT ON parcels
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS bus_tickets_default_idem_trg ON bus_tickets;
CREATE TRIGGER bus_tickets_default_idem_trg
    BEFORE INSERT ON bus_tickets
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS towing_jobs_default_idem_trg ON towing_jobs;
CREATE TRIGGER towing_jobs_default_idem_trg
    BEFORE INSERT ON towing_jobs
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS mover_jobs_default_idem_trg ON mover_jobs;
CREATE TRIGGER mover_jobs_default_idem_trg
    BEFORE INSERT ON mover_jobs
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS car_hire_bookings_default_idem_trg ON car_hire_bookings;
CREATE TRIGGER car_hire_bookings_default_idem_trg
    BEFORE INSERT ON car_hire_bookings
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS business_deliveries_default_idem_trg ON business_deliveries;
CREATE TRIGGER business_deliveries_default_idem_trg
    BEFORE INSERT ON business_deliveries
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

DROP TRIGGER IF EXISTS event_transport_bookings_default_idem_trg ON event_transport_bookings;
CREATE TRIGGER event_transport_bookings_default_idem_trg
    BEFORE INSERT ON event_transport_bookings
    FOR EACH ROW EXECUTE FUNCTION transport_default_idempotency_key();

-- Note on existing UNIQUE: the `idempotency_key TEXT UNIQUE` constraint declared on
-- each table in the two prior migrations is left in place and unchanged. This
-- migration only ensures the column is always populated at insert time; dedupe
-- semantics remain the pre-existing UNIQUE index.
