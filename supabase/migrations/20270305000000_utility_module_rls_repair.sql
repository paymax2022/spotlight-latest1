-- Repairs RLS on the utility module's owner-scoped tables.
--
-- Found 2026-09-17 while troubleshooting a customer-reported "payment
-- unsuccessful" that was actually a successful Paystack charge with a failed
-- vend: the mobile app's status poll (`getUtilityPaystackIntent`, a direct
-- Supabase client read scoped by RLS) got a 403 instead of the real row.
--
-- On inspection, SIX "read own row" policies from two prior migrations
-- (20260613100000_utility_payment_engine.sql, 20260613110000_utility_provider_
-- attempts.sql, 20260614100000_utility_paystack_intents.sql) do not exist on
-- live databases, even though those migrations are recorded as applied and no
-- later migration ever drops them — this is drift, not a migration bug. Every
-- OTHER "read own"-style policy across the schema (150+, e.g. wallet, savings,
-- referrals) is present and unaffected; only this module's six were missing,
-- alongside their base table-level SELECT grant to `authenticated` (RLS alone
-- is not enough — PostgREST/Postgres denies before a policy is even
-- evaluated if the role has no table-level privilege).
--
-- Idempotent: safe to run whether or not the policies/grants already exist.
BEGIN;

DROP POLICY IF EXISTS "utility_transactions_read_own" ON public.utility_transactions;
CREATE POLICY "utility_transactions_read_own" ON public.utility_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "utility_events_read_own" ON public.utility_transaction_events;
CREATE POLICY "utility_events_read_own" ON public.utility_transaction_events
  FOR SELECT TO authenticated USING (
    transaction_id IN (SELECT id FROM public.utility_transactions WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "utility_beneficiaries_own" ON public.saved_utility_beneficiaries;
CREATE POLICY "utility_beneficiaries_own" ON public.saved_utility_beneficiaries
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "utility_disputes_read_own" ON public.utility_disputes;
CREATE POLICY "utility_disputes_read_own" ON public.utility_disputes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "utility_attempts_read_own" ON public.utility_provider_attempts;
CREATE POLICY "utility_attempts_read_own" ON public.utility_provider_attempts
  FOR SELECT TO authenticated USING (
    transaction_id IN (SELECT id FROM public.utility_transactions WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "utility_paystack_intents_read_own" ON public.utility_paystack_intents;
CREATE POLICY "utility_paystack_intents_read_own" ON public.utility_paystack_intents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Base table privilege — required in addition to the policies above; RLS
-- restricts ROWS, it does not substitute for the role's own table grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON public.utility_transactions TO authenticated;
    GRANT SELECT ON public.utility_transaction_events TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_utility_beneficiaries TO authenticated;
    GRANT SELECT ON public.utility_disputes TO authenticated;
    GRANT SELECT ON public.utility_provider_attempts TO authenticated;
    GRANT SELECT ON public.utility_paystack_intents TO authenticated;
  END IF;
END $$;

COMMIT;
