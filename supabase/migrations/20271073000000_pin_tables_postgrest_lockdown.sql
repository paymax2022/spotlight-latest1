-- ADR-PR<n>: lock the PIN-bearing transport tables out of PostgREST.
--
-- parcels (pickup_pin, dropoff_pin), towing_jobs (pin), trips (trip_pin) and
-- business_deliveries (dropoff_pin) each hold a handover secret that the
-- counterparty must VERIFY, never READ. Supabase's default grants gave anon and
-- authenticated every table privilege, so over /rest/v1 with an ordinary JWT:
--   * the courier/driver SELECT policies (parcels_own, towing_own, trips_select,
--     business_deliveries_own) returned the PIN column — the courier could read
--     dropoff_pin and complete the delivery without the receiver;
--   * the owner-only INSERT policies (parcels_insert, towing_insert,
--     trips_insert) let a user write forged rows: any status, their own
--     courier, no payment.
-- Every legitimate read and write of these tables goes through the Go backend
-- as the table owner / service_role (no client calls .from() on them, no RPC
-- or view reads them as the caller, none is in a realtime publication), so
-- anon and authenticated get nothing at all.
--
-- Additive-only: grants are revoked, no table, column or policy is dropped. The
-- now-unreachable authenticated policies are left in place; re-granting SELECT
-- would re-expose the PIN columns, so any future direct client read must be a
-- column-scoped GRANT that omits them.

REVOKE ALL ON TABLE public.parcels             FROM anon, authenticated;
REVOKE ALL ON TABLE public.towing_jobs         FROM anon, authenticated;
REVOKE ALL ON TABLE public.trips               FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_deliveries FROM anon, authenticated;

-- Column-level grants survive a table-level REVOKE; clear any that exist so the
-- PIN columns cannot stay readable through one.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT DISTINCT table_name, column_name, grantee, privilege_type
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name IN ('parcels','towing_jobs','trips','business_deliveries')
          AND grantee IN ('anon','authenticated')
    LOOP
        EXECUTE format('REVOKE %s (%I) ON TABLE public.%I FROM %I',
                       r.privilege_type, r.column_name, r.table_name, r.grantee);
    END LOOP;
END $$;

-- service_role keeps full access explicitly (it is what the backend and admin
-- tooling use when they do not connect as the owner).
GRANT ALL ON TABLE public.parcels             TO service_role;
GRANT ALL ON TABLE public.towing_jobs         TO service_role;
GRANT ALL ON TABLE public.trips               TO service_role;
GRANT ALL ON TABLE public.business_deliveries TO service_role;
