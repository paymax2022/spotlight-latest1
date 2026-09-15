-- Enable RLS on utility_billers table (additive-only, idempotent).
--
-- This is part of Phase 5 of the Utility Bills Next.js→Go migration. The Go
-- backend (running as service_role) reads this table directly via pgx; the
-- Next.js public-read routes now proxy through Go and no longer query
-- Supabase directly.
--
-- Enabling RLS (with no policies) prevents a client-side token (anon or auth)
-- from querying this table directly if RLS policy logic is ever written.
-- Service role ALWAYS bypasses RLS, so the Go backend is unaffected.

-- Check if RLS is already enabled to avoid redundant operations.
DO $$
BEGIN
  -- Enable RLS if not already enabled.
  IF NOT (
    SELECT row_security
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'utility_billers'
  ) THEN
    ALTER TABLE public.utility_billers ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;
