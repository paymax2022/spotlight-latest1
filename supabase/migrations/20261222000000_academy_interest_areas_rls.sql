-- Enable RLS on the two Film Academy interest-area tables, which shipped without it.
--
--   academy_interest_areas        — from 20261218000000_academy_interest_areas.sql
--   academy_batch_interest_areas  — from 20261219000000_academy_batch_interest_areas.sql
--
-- The repo's rls-check gate (Makefile) fails any public table with
-- relrowsecurity = false, and it broke integration-verify on main with:
--
--   RLS CHECK FAILED — public tables without row-level security:
--     academy_batch_interest_areas, academy_interest_areas
--
-- Both tables slipped through for exactly the reason the earlier
-- 20261215000100_module_registry_rls.sql migration documents: integration-verify
-- runs that gate only on pushes to `main`, so the gap sat on `develop` unnoticed.
--
-- DENY-ALL IS THE CORRECT POLICY SET HERE, not a placeholder. Every reader was
-- checked: batchAreas.ts, /api/academy/apply, /api/admin/academy/interest-areas
-- and /api/admin/academy/batches all reach these tables through
-- createAdminClient() — the service role, which bypasses RLS. No supabase-js
-- browser client touches either table anywhere in frontend-web, frontend-admin
-- or mobile. Enabling RLS with no client policy therefore denies
-- PostgREST/anon/authenticated access while leaving every real caller working.
--
-- A permissive SELECT would be worse than nothing here: academy_interest_areas
-- carries the PRICE of each area (fee_ngn), and academy_batch_interest_areas
-- reveals which cohorts offer what before those cohorts open. Applicants receive
-- both through /api/academy/apply, which returns only ACTIVE areas — a policy
-- exposing the raw tables would leak retired areas and unpublished pricing.
--
-- Additive-only: enabling RLS adds a constraint, drops nothing, and narrows no
-- column or type.

ALTER TABLE public.academy_interest_areas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_batch_interest_areas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.academy_interest_areas IS
  'Admin-managed catalogue of Film Academy areas of interest and their tuition prices. RLS enabled, no client policy: backend/service-role access only.';
COMMENT ON TABLE public.academy_batch_interest_areas IS
  'Which interest areas a batch offers. No rows = unrestricted. RLS enabled, no client policy: backend/service-role access only.';
