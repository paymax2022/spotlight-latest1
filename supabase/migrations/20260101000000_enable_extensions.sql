-- Enable required Postgres extensions BEFORE any schema migration that depends on
-- them, so a fresh `supabase db push` applies the whole set in timestamp order:
--   • postgis    — the stays supply schema (stays_property.geo geography(Point,4326),
--                  GIST indexes, ST_MakePoint/ST_SetSRID) and transport/health/maps
--                  geo features. Note several migrations use geometry BEFORE
--                  stays_core self-enables it, so it must be enabled first here.
--   • pgcrypto   — gen_random_bytes/digest and some uuid defaults.
--   • uuid-ossp  — uuid_generate_v4() used by a few older migrations.
--
-- Idempotent (IF NOT EXISTS) and unqualified — matching how the existing migrations
-- reference these types/functions — so a plain Supabase project resolves them.
-- On Supabase these extensions are available out of the box; this file is a no-op
-- if they are already enabled (e.g. postgis toggled on in the dashboard).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
