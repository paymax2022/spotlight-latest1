-- RLS lockdown, wave 3 (same pattern as 20260703225152_rls_backend_only_lockdown.sql
-- and 20261201000000_..._wave2.sql).
--
-- These 8 public tables were created by migrations landing AFTER wave 2 ran, so
-- they shipped without row-level security — caught by `make rls-check` (the
-- fresh-replay-only gate; a table like this can pass every other CI lane and
-- still be un-RLS'd, since rls-check only runs on `make migrate-reset`, not on
-- an incrementally-migrated staging DB). All are reached ONLY by the Go backend
-- (owner 'postgres') or the Next.js server via the service-role client — both
-- BYPASS RLS. No browser/anon-key .from() usage touches any of them:
--   mkt_seller_follows          — backend/internal/marketplace, pgx service pool
--   cf_user_moderation          — frontend-web crowdfunding admin, service-role client
--   assoc_application_documents,
--   assoc_chapter_leaders,
--   assoc_dues_runs,
--   assoc_organisation_rules    — association module, Go pgx service pool
--   academy_rail_webhook_events — academy rail-payment webhook intake, service-role
--   orch_collection_events      — FX orchestration, Go pgx service pool
--
-- Enabling RLS with no policy = deny-all for anon/authenticated; the REVOKE is
-- defence-in-depth, guarded on role existence so bare-Postgres CI is a no-op.
-- NOT using FORCE RLS. Additive, reversible, idempotent.
BEGIN;

DO $rls$ BEGIN IF to_regclass('public.mkt_seller_follows') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_seller_follows ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.cf_user_moderation') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.cf_user_moderation ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_application_documents') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_application_documents ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_chapter_leaders') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_chapter_leaders ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_dues_runs') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_dues_runs ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.assoc_organisation_rules') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.assoc_organisation_rules ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.academy_rail_webhook_events') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.academy_rail_webhook_events ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.orch_collection_events') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.orch_collection_events ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
      'mkt_seller_follows'
    , 'cf_user_moderation'
    , 'assoc_application_documents'
    , 'assoc_chapter_leaders'
    , 'assoc_dues_runs'
    , 'assoc_organisation_rules'
    , 'academy_rail_webhook_events'
    , 'orch_collection_events'
  ] LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
COMMIT;
