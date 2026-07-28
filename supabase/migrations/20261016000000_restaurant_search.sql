-- Restaurant / Delivery — discovery search & filters (Phase 6, additive-only).
--
-- Adds an optional `cuisine` tag to restaurants (the one filter dimension not already
-- in the schema; rating, geo pin, and business hours already exist) plus supporting
-- indexes for the discovery query. No DROP / RENAME / type narrowing.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisine TEXT;

-- Case-insensitive cuisine filter (lower(cuisine) = lower($1)).
CREATE INDEX IF NOT EXISTS restaurants_cuisine_lower_idx ON restaurants (lower(cuisine));
-- Rating sort / min-rating filter over the open-restaurant set.
CREATE INDEX IF NOT EXISTS restaurants_open_rating_idx ON restaurants (is_open, rating DESC);

-- Trigram index to accelerate the name ILIKE '%q%' text search when pg_trgm is
-- available. Guarded so the migration still applies cleanly where the extension can't
-- be created (the search falls back to a sequential ILIKE — correct, just slower).
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX IF NOT EXISTS restaurants_name_trgm_idx ON restaurants USING gin (name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm unavailable — skipping trigram index on restaurants.name (ILIKE search still works)';
END $$;
