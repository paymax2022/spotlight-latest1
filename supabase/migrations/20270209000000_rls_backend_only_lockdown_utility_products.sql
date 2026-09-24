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

-- See 20270208000000_rls_backend_only_lockdown_utility_billers.sql for why
-- this is a direct, unguarded call: ENABLE ROW LEVEL SECURITY is already
-- idempotent, and the previous guard's `information_schema.tables.row_security`
-- reference does not exist in Postgres, which broke fresh replay
-- unconditionally rather than only when RLS was already enabled.
ALTER TABLE public.utility_products ENABLE ROW LEVEL SECURITY;
