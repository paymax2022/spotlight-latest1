-- Read-only inspection of the schema 20271099000070 promotes, captured for the Phase 2.5a transcript.
-- Nothing in this file changes state: every statement is a SELECT against the catalog.

\echo '=== 1. estate_notifications: the two columns the case needed (archived_at, pinned) ==='
SELECT column_name, data_type, is_nullable, COALESCE(column_default, '-') AS default_value
FROM information_schema.columns
WHERE table_name = 'estate_notifications'
  AND column_name IN ('id', 'read_at', 'archived_at', 'pinned', 'category', 'created_at')
ORDER BY ordinal_position;

\echo '=== 2. indexes on estate_notifications: active half, archived half, trigram search ==='
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'estate_notifications'
ORDER BY indexname;

\echo '=== 3. pg_trgm availability decides whether search is indexed or a seq scan ==='
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') AS pg_trgm_installed;

\echo '=== 4. the retention policy table: RLS on, defaults, and every CHECK ==='
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'estate_notification_retention_policies';
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'estate_notification_retention_policies'::regclass
ORDER BY conname;
SELECT column_name, is_nullable, COALESCE(column_default, '-') AS default_value
FROM information_schema.columns
WHERE table_name = 'estate_notification_retention_policies'
ORDER BY ordinal_position;
SELECT polname, polcmd, polroles::regrole[] AS for_roles FROM pg_policy
WHERE polrelid = 'estate_notification_retention_policies'::regclass;

\echo '=== 5. the purge guard: a BEFORE DELETE trigger, enabled, on every delete path ==='
SELECT tgname, tgtype, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'estate_notifications'::regclass AND NOT tgisinternal;

\echo '=== 6. the sweep functions: SECURITY DEFINER, service_role-only EXECUTE ==='
SELECT p.proname, p.prosecdef AS security_definer,
       pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute
FROM pg_proc p
WHERE p.proname IN ('estate_notifications_apply_retention', 'estate_notifications_retention_for_estate')
ORDER BY p.proname;

\echo '=== 7. the argumentless entry point keeps its DEFAULT NULL (NULL = every estate) ==='
SELECT p.proname, pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p WHERE p.proname = 'estate_notifications_apply_retention';

\echo '=== 8. the promoted draft is present verbatim: the pending file only ever added archived_at ==='
SELECT column_name FROM information_schema.columns
WHERE table_name = 'estate_notifications' AND column_name = 'archived_at';
