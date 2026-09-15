-- RLS lockdown: mkt_notifications, voting_support_tickets, voting_ticket_messages
-- (same pattern as 20260703225152_rls_backend_only_lockdown.sql,
-- 20261201000000_..._wave2.sql, 20270155000000_..._wave3.sql, and
-- 20270170000000_restaurant_likes_rls_lockdown.sql).
--
-- 20270198000000_marketplace_notifications_and_voting_support.sql created these
-- three tables but never executed ENABLE ROW LEVEL SECURITY, so `make rls-check`
-- (the fresh-replay-only gate; passes every other CI lane and still catches
-- this, since it only runs on `make migrate-reset`, not an incrementally-
-- migrated staging DB) correctly failed on main. This is the missing
-- statement, not a new design decision — all three tables are reached ONLY by
-- the Go backend (backend/internal/marketplace/service_notifications.go,
-- backend/internal/connect/voting/support_service.go + support_handler.go,
-- pgx pool / database/sql), which BYPASSES RLS. No browser/anon-key .from()
-- usage touches any of them.
--
-- Enabling RLS with no policy = deny-all for anon/authenticated; the REVOKE is
-- defence-in-depth, guarded on role existence so bare-Postgres CI is a no-op.
-- NOT using FORCE RLS. Additive, reversible, idempotent.
BEGIN;

DO $rls$ BEGIN IF to_regclass('public.mkt_notifications') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.mkt_notifications ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.voting_support_tickets') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.voting_support_tickets ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.voting_ticket_messages') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.voting_ticket_messages ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

DO $$
BEGIN
  IF to_regclass('public.mkt_notifications') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.mkt_notifications FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.mkt_notifications FROM authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.voting_support_tickets') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.voting_support_tickets FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.voting_support_tickets FROM authenticated';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.voting_ticket_messages') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.voting_ticket_messages FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.voting_ticket_messages FROM authenticated';
  END IF;
END $$;

COMMIT;
