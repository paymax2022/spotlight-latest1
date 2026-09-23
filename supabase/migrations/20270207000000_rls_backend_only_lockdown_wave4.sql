-- RLS lockdown, wave 4 — the Utility Bills money-path tables.
--
-- Same pattern as 20260703225152_rls_backend_only_lockdown.sql and its wave-2 /
-- wave-3 successors: enable RLS, leave NO policy (which is deny-all for anon and
-- authenticated), and REVOKE as defence in depth, every statement guarded so a
-- bare-Postgres CI run or a partially-migrated database is a no-op.
--
-- WHY NOW: Phase 1 of the Utility Bills Next.js → Go migration moves every write
-- on these tables behind the Go backend's pgx service pool (owner 'postgres',
-- which BYPASSES RLS). The Next.js implementation likewise reaches them only via
-- the service-role client, which also bypasses RLS. So the direct-from-browser
-- SELECT policies these tables shipped with in 20260613100000 are no longer
-- reachable by any supported client — and while they stand, an anon/authenticated
-- key can still read a member's meter numbers, provider references and vended
-- electricity TOKENS straight out of the database.
--
-- Two differences from waves 1-3, both deliberate:
--
--  1. These tables DO have existing policies (wave 1-3's tables had none), so the
--     policies are dropped explicitly. Enabling RLS on a table that already has a
--     permissive SELECT policy changes nothing at all.
--
--  2. utility_billers and utility_products are NOT touched. They are the public
--     CATALOGUE — mobile still reads them directly with the anon key until Phase 5
--     moves catalogue browsing onto Go endpoints. Locking them here would break
--     the live app's biller/product pickers, and they carry no member data.
--     utility_providers / utility_provider_product_mappings / utility_routing_rules
--     are also left as they are: they already have RLS on with no policy (deny-all)
--     from their original migration, which is the state this wave is aiming for.
--
-- Additive, reversible, idempotent. NOT using FORCE RLS — forcing it would lock
-- out the table OWNER too, which is precisely the backend that has to write here
-- (the trap documented for connect_votes/bridge_outbox).
BEGIN;

-- ── 1. Drop the browser-facing policies ─────────────────────────────────────
DROP POLICY IF EXISTS "utility_transactions_read_own"       ON public.utility_transactions;
DROP POLICY IF EXISTS "utility_events_read_own"             ON public.utility_transaction_events;
DROP POLICY IF EXISTS "utility_attempts_read_own"           ON public.utility_provider_attempts;
DROP POLICY IF EXISTS "utility_beneficiaries_own"           ON public.saved_utility_beneficiaries;
DROP POLICY IF EXISTS "utility_disputes_read_own"           ON public.utility_disputes;
DROP POLICY IF EXISTS "utility_paystack_intents_read_own"   ON public.utility_paystack_intents;

-- ── 2. Ensure RLS is on (idempotent guard style, waves 1-3) ─────────────────
DO $rls$ BEGIN IF to_regclass('public.utility_transactions') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_transactions ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.utility_provider_attempts') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_provider_attempts ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.utility_transaction_events') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_transaction_events ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.utility_disputes') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_disputes ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.utility_paystack_intents') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_paystack_intents ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.saved_utility_beneficiaries') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.saved_utility_beneficiaries ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;
DO $rls$ BEGIN IF to_regclass('public.utility_provider_bind') IS NOT NULL THEN EXECUTE 'ALTER TABLE public.utility_provider_bind ENABLE ROW LEVEL SECURITY'; END IF; END $rls$;

-- ── 3. Revoke direct grants (defence in depth) ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
      'utility_transactions'
    , 'utility_provider_attempts'
    , 'utility_transaction_events'
    , 'utility_disputes'
    , 'utility_paystack_intents'
    , 'saved_utility_beneficiaries'
    , 'utility_provider_bind'
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
