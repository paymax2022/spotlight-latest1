-- Phase 2.4 schema proof: is 20271099000060_estate_occupancy_integrity.sql actually present in the
-- running local database, in the shape the Go service assumes?
--
--   docker exec -i supabase_db_spotlight psql -U postgres -d postgres -f - < docs/qa/estate-uat-443/live-2026-10-27/05-schema-occupancy.sql
--
-- Read-only: every statement is a SELECT.
\pset border 2
\echo '--- 1. the occupancy registry table, its RLS state and its table constraints'
SELECT c.relname, c.relrowsecurity,
       (SELECT string_agg(conname, ', ' ORDER BY conname)
          FROM pg_constraint con WHERE con.conrelid = c.oid
             AND (con.conname LIKE 'estate_unit_occupants%')) AS constraints
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('estate_unit_occupants','estate_properties')
ORDER BY c.relname;

\echo '--- 2. capacity + dues-exemption columns and their defaults'
SELECT table_name, column_name, data_type, coalesce(column_default,'(none)') AS column_default
FROM information_schema.columns
WHERE table_schema='public'
  AND ( (table_name='estate_properties' AND column_name IN ('capacity','occupancy_status','landlord_id','tenant_id'))
     OR (table_name='estate_dues_invoices' AND column_name LIKE '%override%')
     OR (table_name='resident_profiles' AND column_name LIKE 'proof%')
     OR (table_name='tenancy_requests' AND column_name IN ('reviewed_by','reject_reason')) )
ORDER BY table_name, column_name;

\echo '--- 3. the enforcing triggers and the functions they call'
SELECT t.tgname, cl.relname AS on_table, p.proname AS function, p.prosecdef AS security_definer
FROM pg_trigger t
JOIN pg_class cl ON cl.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (t.tgname LIKE 'estate_enforce%' OR t.tgname LIKE 'estate_%occupant%' OR t.tgname LIKE 'estate_reset_proof%')
ORDER BY cl.relname, t.tgname;

\echo '--- 4. the single admitting/releasing writers must be SECURITY DEFINER and owner-only executable'
SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
       (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
          FROM information_schema.role_routine_grants g
         WHERE g.routine_name = p.proname AND g.grantee <> 'postgres') AS non_owner_grants
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('estate_occupancy_admit','estate_occupancy_release')
ORDER BY p.proname;

\echo '--- 5. the two dues-exemption CHECKs and the proof-state CHECK are live constraints'
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('estate_dues_invoices_vacancy_override_reason',
                  'estate_dues_invoices_term_override_reason',
                  'resident_profiles_proof_status_check',
                  'estate_unit_occupants_window_ordered',
                  'estate_unit_occupants_occupancy_type_check')
ORDER BY conname;

\echo '--- 5b. the one-owner / one-tenant overlap rule is a PARTIAL UNIQUE INDEX, not a table constraint'
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='estate_unit_occupants'
ORDER BY indexname;

\echo '--- 6. RLS policies on the registry (service-role writer only)'
SELECT polname, polcmd, polroles::regrole[],
       pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy WHERE polrelid = 'estate_unit_occupants'::regclass ORDER BY polname;
