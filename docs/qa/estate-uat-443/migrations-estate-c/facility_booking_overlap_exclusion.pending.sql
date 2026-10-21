-- estate-c lane pending migration (NOT applied). Additive-only.
-- Durable race guard for EST-UAT-0248 (facility double-reserve): the
-- service/BFF overlap check rejects conflicts politely, but two concurrent
-- INSERTs can still interleave. This exclusion constraint makes the overlap
-- physically impossible at the database level for active bookings.
-- Apply at consolidation; renumber into the migrations chain.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE facility_bookings
    ADD CONSTRAINT facility_bookings_no_overlap
    EXCLUDE USING gist (
        facility_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    )
    WHERE (status IN ('pending', 'confirmed'));
