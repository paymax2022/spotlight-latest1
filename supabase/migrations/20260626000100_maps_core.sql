-- MapService core tables — provider-agnostic maps abstraction.
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
-- Requires PostGIS (20260626000000_enable_postgis.sql).
--
-- Design rules enforced here:
--   * findNearbyOwn / isInZone run on merchant_locations + service_areas via
--     GiST indexes (ST_DWithin / ST_Contains) — NEVER a maps API.
--   * geocode_cache stores OpenStack (OSM-licensed) geocode/reverse results ONLY.
--     Google results are never persisted (enforced in the Go cache writer).
--   * map_usage backs the cost guard (per-provider, per-primitive, per-month).

-- ─── merchant_locations ───────────────────────────────────────────────────────
-- Our OWN records' confirmed pins (source of truth) + Plus Code label.
CREATE TABLE IF NOT EXISTS merchant_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id   TEXT NOT NULL,                         -- merchant/restaurant/driver/... id
    entity_type TEXT NOT NULL,                         -- 'merchant' | 'restaurant' | 'driver' | ...
    geog        GEOGRAPHY(Point, 4326) NOT NULL,       -- WGS84 pin
    plus_code   TEXT,                                  -- Open Location Code (label/source of truth)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT merchant_locations_entity_unique UNIQUE (entity_id, entity_type)
);
-- Spatial index for ST_DWithin (near-me) and a btree for entity_type filtering.
CREATE INDEX IF NOT EXISTS idx_merchant_locations_geog ON merchant_locations USING GIST (geog);
CREATE INDEX IF NOT EXISTS idx_merchant_locations_type ON merchant_locations (entity_type);

-- ─── service_areas ────────────────────────────────────────────────────────────
-- Coverage / geofence polygons. id is TEXT so zones can be human-readable
-- ('lagos-island', 'ikeja-gra') or a UUID — referenced by isInZone(zone_id).
CREATE TABLE IF NOT EXISTS service_areas (
    id         TEXT PRIMARY KEY,
    owner_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name       TEXT,
    geog       GEOGRAPHY(Polygon, 4326) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_areas_geog ON service_areas USING GIST (geog);
CREATE INDEX IF NOT EXISTS idx_service_areas_owner ON service_areas (owner_id);

-- ─── geocode_cache (OpenStack / OSM ONLY) ─────────────────────────────────────
-- Each normalized address is resolved once. The Go cache writer REFUSES to
-- persist non-OSM (e.g. Google) results, so this table only ever holds
-- OSM-licensed data, satisfying Google's no-cache terms.
CREATE TABLE IF NOT EXISTS geocode_cache (
    normalized_query TEXT PRIMARY KEY,
    lat              DOUBLE PRECISION NOT NULL,
    lng              DOUBLE PRECISION NOT NULL,
    plus_code        TEXT,
    provider         TEXT NOT NULL,                    -- e.g. 'geoapify' (OSM-licensed only)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ttl_seconds      BIGINT NOT NULL DEFAULT 2592000   -- 30 days
);
CREATE INDEX IF NOT EXISTS idx_geocode_cache_created ON geocode_cache (created_at);

-- ─── map_usage (cost guard) ───────────────────────────────────────────────────
-- Per-provider, per-primitive monthly call counts. Powers budget alerts
-- (50/75/90%) and the soft-cap -> graceful-degradation decision.
CREATE TABLE IF NOT EXISTS map_usage (
    provider   TEXT NOT NULL,
    primitive  TEXT NOT NULL,                          -- geocode | autocomplete | places | route | ...
    month      TEXT NOT NULL,                          -- 'YYYY-MM' (UTC)
    count      BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (provider, primitive, month)
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- The Go MapService connects via the direct pgx pool (service-role/owner) and
-- bypasses RLS; these policies harden any access via the Supabase REST layer.
ALTER TABLE merchant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_areas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE geocode_cache      ENABLE ROW LEVEL SECURITY;
ALTER TABLE map_usage          ENABLE ROW LEVEL SECURITY;

-- Locations + zones: readable by any authenticated user (discovery/near-me);
-- writes go through the backend (service role).
CREATE POLICY "merchant_locations_select" ON merchant_locations FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "service_areas_select" ON service_areas FOR SELECT TO authenticated USING (TRUE);

-- Cache + usage are operational tables — no direct client access (deny by
-- default once RLS is on; the backend service role bypasses RLS).
