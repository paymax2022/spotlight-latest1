-- Flow restaurant / estate / realtor coordinates into merchant_locations so
-- their "near me" runs on PostGIS (MapService.FindNearbyOwn → ST_DWithin).
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
-- Requires merchant_locations (20260626000100_maps_core.sql).
--
-- Approach:
--   * realtor_properties already has geo_lat/geo_lng → sync directly.
--   * restaurants/estates store only a text address → add OPTIONAL geo columns
--     (populated by the AddressEntry pin flow / POST /api/finance/maps/locations,
--     or by an admin). When coordinates are present, they sync automatically.
--   * A shared trigger keeps merchant_locations in lock-step on INSERT/UPDATE/
--     DELETE. entity_type is passed as a trigger argument.

-- ─── Optional geo columns for address-only entities ───────────────────────────
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS geo_lat   NUMERIC(9,6);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS geo_lng   NUMERIC(9,6);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS plus_code TEXT;

ALTER TABLE estates     ADD COLUMN IF NOT EXISTS geo_lat   NUMERIC(9,6);
ALTER TABLE estates     ADD COLUMN IF NOT EXISTS geo_lng   NUMERIC(9,6);
ALTER TABLE estates     ADD COLUMN IF NOT EXISTS plus_code TEXT;

-- ─── Shared sync function ─────────────────────────────────────────────────────
-- Upserts (or removes) a merchant_locations row from the firing table's NEW/OLD
-- row. entity_type comes from TG_ARGV[0]. Only references geo_lat/geo_lng (every
-- target table has them after this migration), so it is reusable across modules.
CREATE OR REPLACE FUNCTION sync_merchant_location() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    etype TEXT := TG_ARGV[0];
BEGIN
    IF TG_OP = 'DELETE' THEN
        DELETE FROM merchant_locations
        WHERE entity_id = OLD.id::text AND entity_type = etype;
        RETURN OLD;
    END IF;

    IF NEW.geo_lat IS NULL OR NEW.geo_lng IS NULL THEN
        -- No pin yet: nothing to project. (Address-only rows wait for a pin.)
        RETURN NEW;
    END IF;

    -- plus_code is intentionally omitted: PostGIS can't compute an Open Location
    -- Code. It is left NULL here and written by the Go MapService when the
    -- confirmed pin is captured (POST /api/finance/maps/locations). The ON
    -- CONFLICT update leaves any existing plus_code untouched.
    INSERT INTO merchant_locations (entity_id, entity_type, geog, updated_at)
    VALUES (
        NEW.id::text,
        etype,
        ST_SetSRID(ST_MakePoint(NEW.geo_lng, NEW.geo_lat), 4326)::geography,
        NOW()
    )
    ON CONFLICT (entity_id, entity_type)
    DO UPDATE SET geog = EXCLUDED.geog, updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Note on plus_code: PostGIS cannot compute an Open Location Code, so the trigger
-- leaves merchant_locations.plus_code untouched on update and NULL on first
-- insert. The Plus Code (source of truth) is written by the Go MapService when
-- the confirmed pin is captured via POST /api/finance/maps/locations.

-- ─── Triggers (idempotent via CREATE OR REPLACE TRIGGER, PG14+) ───────────────
CREATE OR REPLACE TRIGGER trg_sync_loc_restaurants
    AFTER INSERT OR UPDATE OF geo_lat, geo_lng OR DELETE ON restaurants
    FOR EACH ROW EXECUTE FUNCTION sync_merchant_location('restaurant');

CREATE OR REPLACE TRIGGER trg_sync_loc_estates
    AFTER INSERT OR UPDATE OF geo_lat, geo_lng OR DELETE ON estates
    FOR EACH ROW EXECUTE FUNCTION sync_merchant_location('estate');

CREATE OR REPLACE TRIGGER trg_sync_loc_realtor_properties
    AFTER INSERT OR UPDATE OF geo_lat, geo_lng OR DELETE ON realtor_properties
    FOR EACH ROW EXECUTE FUNCTION sync_merchant_location('realtor_property');

-- ─── Backfill existing rows that already have coordinates ─────────────────────
INSERT INTO merchant_locations (entity_id, entity_type, geog, updated_at)
SELECT id::text, 'realtor_property',
       ST_SetSRID(ST_MakePoint(geo_lng, geo_lat), 4326)::geography, NOW()
FROM realtor_properties
WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL
ON CONFLICT (entity_id, entity_type)
DO UPDATE SET geog = EXCLUDED.geog, updated_at = NOW();

INSERT INTO merchant_locations (entity_id, entity_type, geog, updated_at)
SELECT id::text, 'restaurant',
       ST_SetSRID(ST_MakePoint(geo_lng, geo_lat), 4326)::geography, NOW()
FROM restaurants
WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL
ON CONFLICT (entity_id, entity_type)
DO UPDATE SET geog = EXCLUDED.geog, updated_at = NOW();

INSERT INTO merchant_locations (entity_id, entity_type, geog, updated_at)
SELECT id::text, 'estate',
       ST_SetSRID(ST_MakePoint(geo_lng, geo_lat), 4326)::geography, NOW()
FROM estates
WHERE geo_lat IS NOT NULL AND geo_lng IS NOT NULL
ON CONFLICT (entity_id, entity_type)
DO UPDATE SET geog = EXCLUDED.geog, updated_at = NOW();
