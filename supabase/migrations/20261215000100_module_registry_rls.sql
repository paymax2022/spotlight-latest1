-- Enable RLS on four public tables that shipped without it (additive-only).
--
--   platform_modules, platform_module_environments, platform_module_audit
--     — from 20261210000000_platform_module_registry.sql
--   restaurant_staff
--     — from 20261212000000_restaurant_staff.sql
--
-- The repo's rls-check gate (Makefile) fails any public table with
-- relrowsecurity = false. These four slipped through because integration-verify,
-- which runs that gate, only triggers on pushes to `main` — so the gap sat on
-- `develop` unnoticed until a PR ran the lane.
--
-- DENY-ALL IS THE CORRECT POLICY SET HERE, not a placeholder. Every one of these
-- tables is backend-only: no supabase-js client reads any of them (verified across
-- frontend-web, frontend-admin and mobile), and the Go service reaches them over a
-- direct pgx connection as the table owner, which bypasses RLS. So enabling RLS
-- without granting a client policy denies PostgREST/anon/authenticated access while
-- leaving every real caller working — the same shape as restaurant_promos, whose
-- migration notes "no client policy is granted".
--
-- Granting a permissive SELECT here would be worse than leaving it: platform_modules
-- and platform_module_environments describe UNRELEASED work, and platform_module_audit
-- is an admin action trail. Neither should be readable by a logged-in end user.

ALTER TABLE public.platform_modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_module_environments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_module_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_staff              ENABLE ROW LEVEL SECURITY;
