-- Migration: Close PII exposure in user_profiles admin policies
-- Timestamp: 20270205010000
--
-- 20260401010000_admin_panel_policies.sql added two policies on
-- public.user_profiles with USING (true)/WITH CHECK (true): despite their
-- names and comments claiming an "admin panel" scope, they had no admin
-- check at all. Any authenticated user could SELECT (and UPDATE
-- application_status on) every other user's profile row -- phone, email,
-- and everything else the table stores -- via PostgREST/the Supabase JS
-- client. This is platform-wide, not module-specific.
--
-- Fix: replace USING (true) with public.is_admin(), the same
-- SECURITY DEFINER admin-role check already used by every other
-- admin-scoped RLS policy in this repo (see 20260405200000_admin_role_setup.sql
-- and e.g. 20260505110000_film_academy_admin_ops.sql).
--
-- No narrower non-admin carve-out is added here: the actual admin console
-- reads user_profiles server-side via the service-role client
-- (createAdminClient in frontend-web/lib/supabase/server.ts), which bypasses
-- RLS entirely and was never depending on the USING (true) predicate. A
-- repo-wide search found no client-side (anon/authenticated-key) read of
-- user_profiles outside admin/server code -- in particular no realtor
-- agent-phone-reveal feature reads this table directly, so there is nothing
-- legitimate to preserve by loosening the predicate further. If a future
-- feature needs a narrow non-admin read (e.g. a realtor listing exposing its
-- own agent's phone to an interested buyer), it should get its own
-- purpose-built, column-scoped policy rather than reopening this one.
--
-- See ADR-PR181 (docs/adr/ADR-PR181-user-profiles-admin-rls-fix.md) for the
-- full decision record.

DROP POLICY IF EXISTS "admin_read_all_user_profiles" ON public.user_profiles;
CREATE POLICY "admin_read_all_user_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_application_status" ON public.user_profiles;
CREATE POLICY "admin_update_application_status"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
