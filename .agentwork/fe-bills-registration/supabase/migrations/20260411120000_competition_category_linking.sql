-- ============================================================
-- Competition Category Linking
-- Extends contests to support multiple categories and team enrollment.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.skill_categories(id) ON DELETE CASCADE,
  subcategory_slug TEXT NOT NULL DEFAULT '',
  config_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_categories_unique
  ON public.competition_categories(competition_id, category_id, subcategory_slug);

CREATE INDEX IF NOT EXISTS idx_competition_categories_competition
  ON public.competition_categories(competition_id, is_active);

ALTER TABLE public.competition_enrollments
  ADD COLUMN IF NOT EXISTS skill_profile_id UUID REFERENCES public.user_skill_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'solo',
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS team_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP INDEX IF EXISTS public.idx_competition_enrollments_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_enrollments_unique_legacy
  ON public.competition_enrollments(competition_id, user_id)
  WHERE skill_profile_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_enrollments_unique_skill
  ON public.competition_enrollments(competition_id, user_id, skill_profile_id)
  WHERE skill_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.competition_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES public.competition_enrollments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role_name TEXT NOT NULL DEFAULT '',
  is_team_lead BOOLEAN NOT NULL DEFAULT false,
  consent_accepted BOOLEAN NOT NULL DEFAULT false,
  consent_accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_team_members_enrollment
  ON public.competition_team_members(enrollment_id, is_team_lead DESC, created_at ASC);

CREATE OR REPLACE FUNCTION public.update_competition_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_categories_updated_at ON public.competition_categories;
CREATE TRIGGER set_competition_categories_updated_at
  BEFORE UPDATE ON public.competition_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_categories_updated_at();

DROP TRIGGER IF EXISTS set_competition_team_members_updated_at ON public.competition_team_members;
CREATE TRIGGER set_competition_team_members_updated_at
  BEFORE UPDATE ON public.competition_team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_categories_updated_at();

ALTER TABLE public.competition_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_competition_categories" ON public.competition_categories;
CREATE POLICY "public_read_competition_categories"
ON public.competition_categories FOR SELECT TO public
USING (is_active = true);

DROP POLICY IF EXISTS "admin_manage_competition_categories" ON public.competition_categories;
CREATE POLICY "admin_manage_competition_categories"
ON public.competition_categories FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_competition_team_members" ON public.competition_team_members;
CREATE POLICY "users_read_own_competition_team_members"
ON public.competition_team_members FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_enrollments e
    WHERE e.id = enrollment_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "users_manage_own_competition_team_members" ON public.competition_team_members;
CREATE POLICY "users_manage_own_competition_team_members"
ON public.competition_team_members FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_enrollments e
    WHERE e.id = enrollment_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.competition_enrollments e
    WHERE e.id = enrollment_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);
