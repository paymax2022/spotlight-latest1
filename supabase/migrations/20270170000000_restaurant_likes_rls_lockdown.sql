-- RLS lockdown: restaurant_likes (same pattern as 20260703225152_rls_backend_only_lockdown.sql,
-- 20261201000000_..._wave2.sql, and 20270155000000_..._wave3.sql).
--
-- 20270166000000_restaurant_likes.sql's header already documents this table's
-- intended posture — "RLS DISABLED, same posture as mkt_seller_follows ... no
-- PostgREST/anon-key path reaches these rows" — but the migration never
-- actually executed ENABLE ROW LEVEL SECURITY, so `make rls-check` (the
-- fresh-replay-only gate; passes every other CI lane and still catches this,
-- since it only runs on `make migrate-reset`, not an incrementally-migrated
-- staging DB) correctly failed on main. The doc comment described the
-- intended lockdown; this migration is the missing statement, not a new
-- design decision — restaurant_likes is reached ONLY by the Go backend
-- (backend/internal/restaurant/likes.go, pgx service pool), which BYPASSES
-- RLS. No browser/anon-key .from() usage touches it.
--
-- Enabling RLS with no policy = deny-all for anon/authenticated; the REVOKE is
-- defence-in-depth, guarded on role existence so bare-Postgres CI is a no-op.
-- NOT using FORCE RLS. Additive, reversible, idempotent.
BEGIN;

DO $rls$ BEGIN IF to_regclass('public.restaurant_likes') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.restaurant_likes ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

DO $$
BEGIN
  IF to_regclass('public.restaurant_likes') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.restaurant_likes FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.restaurant_likes FROM authenticated';
  END IF;
END $$;

COMMIT;
