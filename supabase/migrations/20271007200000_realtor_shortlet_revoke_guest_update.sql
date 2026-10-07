-- realtor_shortlet_bookings: revoke direct UPDATE/DELETE for end users.
--
-- The "User manages own shortlet bookings" policy is FOR ALL, and Supabase's
-- default privileges grant authenticated full table access — so any guest could
-- PATCH their booking's estate_id / status / total_kobo / estate_pass_id /
-- access_code via PostgREST. The estate_id override was the gate-pass mint
-- primitive (a guest could bind their booking to an arbitrary estate and have a
-- visitor pass auto-issued); total_kobo/status rewrites corrupt the settlement
-- record; estate_pass_id lets a guest attach a pass they never earned.
--
-- All legitimate writes are SECURITY DEFINER RPCs (realtor_create_shortlet_booking,
-- check-in/cancel flows) or the service-role backend — both bypass table GRANTs.
-- No client code issues a direct UPDATE/DELETE on this table (mobile SELECTs only).
-- SELECT stays enabled; the RLS policy still scopes rows to the owner.

REVOKE UPDATE, DELETE ON public.realtor_shortlet_bookings FROM authenticated;
REVOKE UPDATE, DELETE ON public.realtor_shortlet_bookings FROM anon;
