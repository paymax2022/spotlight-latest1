-- Enable RLS on utility_products table (additive-only, idempotent).
--
-- This is part of Phase 5 of the Utility Bills Next.js→Go migration. The Go
-- backend (running as service_role) reads this table directly via pgx; the
-- Next.js public-read routes now proxy through Go and no longer query
-- Supabase directly.
--
-- Enabling RLS (with no policies) prevents a client-side token (anon or auth)
-- from querying this table directly if RLS policy logic is ever written.
-- Service role ALWAYS bypasses RLS, so the Go backend is unaffected.

-- ENABLE ROW LEVEL SECURITY is itself idempotent (a no-op if already enabled),
-- so no existence guard is needed — see 20261215000100_module_registry_rls.sql
-- and 20261222000000_academy_interest_areas_rls.sql for the same pattern.
--
-- (This migration originally guarded on `information_schema.tables.row_security`,
-- which is not a real Postgres column and made every fresh-replay fail outright —
-- fixed here rather than via a correction migration since it never applied.)
ALTER TABLE public.utility_products ENABLE ROW LEVEL SECURITY;
