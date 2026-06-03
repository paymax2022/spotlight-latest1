-- Add avatar_url and role columns to user_profiles
-- Used by the Offcanvas profile panel and admin auth guard.

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url  text,
  ADD COLUMN IF NOT EXISTS role        text NOT NULL DEFAULT 'member';

-- Index for fast role lookups (used on every admin auth check)
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);

-- Backfill role from Supabase auth metadata for any existing admin users
UPDATE public.user_profiles up
SET role = COALESCE(
  (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = up.id),
  (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = up.id),
  'member'
)
WHERE role = 'member';

COMMIT;
