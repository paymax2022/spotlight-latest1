-- Estate UAT (EST-UAT-0248, lane estate-c): facility double-reserve guard. The
-- BFF overlap check rejects conflicts politely, but two concurrent INSERTs can
-- interleave; this exclusion constraint makes overlapping active bookings on
-- one facility impossible at the database level. Additive-only.
--
-- Guarded + idempotent: skipped if already present, and skipped with a WARNING
-- if live data already holds overlapping active bookings.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facility_bookings_no_overlap') THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM facility_bookings a JOIN facility_bookings b
      ON a.facility_id = b.facility_id AND a.id < b.id
     AND a.status IN ('pending', 'confirmed') AND b.status IN ('pending', 'confirmed')
     AND tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)
  ) THEN
    RAISE WARNING 'facility_bookings_no_overlap skipped: overlapping active bookings exist — resolve, then re-run';
    RETURN;
  END IF;
  ALTER TABLE facility_bookings
    ADD CONSTRAINT facility_bookings_no_overlap
    EXCLUDE USING gist (
      facility_id WITH =,
      tstzrange(starts_at, ends_at) WITH &&
    )
    WHERE (status IN ('pending', 'confirmed'));
END $$;
