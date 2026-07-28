-- Enable PostGIS for the provider-agnostic MapService layer.
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
--
-- PostGIS powers our OWN spatial queries (near-me + geofencing) so they run on
-- our data via GiST indexes (ST_DWithin / ST_Contains) — never a paid maps API.
-- Supabase ships the postgis extension; this is idempotent and safe to re-run.

CREATE EXTENSION IF NOT EXISTS postgis;
