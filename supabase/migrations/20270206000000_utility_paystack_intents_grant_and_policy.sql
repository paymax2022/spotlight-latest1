-- Fix: utility_paystack_intents (20260614100000) enabled RLS with a
-- read-own SELECT policy but never issued an explicit GRANT to
-- `authenticated` for the table itself. On an environment where the
-- table predates any default-privilege bootstrap for anon/authenticated
-- on public schema tables, that leaves the role with NO privilege on the
-- relation at all — Postgres then raises 42501 (insufficient_privilege)
-- BEFORE row security is even evaluated, which PostgREST surfaces as a
-- flat 403 on every direct client status poll
-- (GET .../utility_paystack_intents?payment_reference=eq.UTIL_...), even
-- for the row's own owning user.
--
-- Symptom observed live: `utility_paystack_intents_read_own` policy was
-- also absent from at least one running environment's actual catalog
-- despite the original migration defining it (drift). Re-issuing
-- CREATE POLICY here (guarded by DROP POLICY IF EXISTS, so it is a no-op
-- where the policy already exists correctly) repairs that regardless of
-- how it happened. Additive-only: only adds a privilege / restores an
-- existing own-row-only read policy, never widens access beyond it.
GRANT SELECT ON public.utility_paystack_intents TO authenticated;

DROP POLICY IF EXISTS "utility_paystack_intents_read_own" ON public.utility_paystack_intents;
CREATE POLICY "utility_paystack_intents_read_own"
  ON public.utility_paystack_intents
  FOR SELECT
  USING (auth.uid() = user_id);
