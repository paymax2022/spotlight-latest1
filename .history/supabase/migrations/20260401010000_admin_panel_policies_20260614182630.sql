-- Migration: Add admin panel read/update policies for user_profiles
-- Timestamp: 20260401010000

-- Allow any authenticated user to SELECT all user_profiles (for admin panel)
DROP POLICY IF EXISTS "admin_read_all_user_profiles" ON public.user_profiles;
CREATE POLICY "admin_read_all_user_profiles"
ON public.user_profiles
FOR SELECT
TO authenticated
USING (true);

-- Allow any authenticated user to UPDATE application_status on any profile (for admin panel)
DROP POLICY IF EXISTS "admin_update_application_status" ON public.user_profiles;
CREATE POLICY "admin_update_application_status"
ON public.user_profiles
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);
