-- ============================================================
-- User Skill Profiles
-- Adds per-user skill identity, portfolio media, and achievements.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_skill_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.skill_categories(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  skill_level TEXT NOT NULL DEFAULT 'beginner',
  identity_mode TEXT NOT NULL DEFAULT 'solo',
  years_experience INTEGER,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'Nigeria',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skill_profiles_primary_per_user
  ON public.user_skill_profiles(user_id)
  WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_skill_profiles_user_category
  ON public.user_skill_profiles(user_id, category_id);

CREATE INDEX IF NOT EXISTS idx_user_skill_profiles_category
  ON public.user_skill_profiles(category_id, is_public, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_skill_portfolio_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.user_skill_profiles(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'image',
  media_url TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_skill_portfolio_media_profile
  ON public.user_skill_portfolio_media(profile_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.user_skill_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.user_skill_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  year_obtained INTEGER,
  description TEXT NOT NULL DEFAULT '',
  proof_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_skill_achievements_profile
  ON public.user_skill_achievements(profile_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_user_skill_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_user_skill_profiles_updated_at ON public.user_skill_profiles;
CREATE TRIGGER set_user_skill_profiles_updated_at
  BEFORE UPDATE ON public.user_skill_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_skill_profiles_updated_at();

DROP TRIGGER IF EXISTS set_user_skill_portfolio_media_updated_at ON public.user_skill_portfolio_media;
CREATE TRIGGER set_user_skill_portfolio_media_updated_at
  BEFORE UPDATE ON public.user_skill_portfolio_media
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_skill_profiles_updated_at();

DROP TRIGGER IF EXISTS set_user_skill_achievements_updated_at ON public.user_skill_achievements;
CREATE TRIGGER set_user_skill_achievements_updated_at
  BEFORE UPDATE ON public.user_skill_achievements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_skill_profiles_updated_at();

ALTER TABLE public.user_skill_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skill_portfolio_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_skill_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_skill_profiles" ON public.user_skill_profiles;
CREATE POLICY "users_manage_own_skill_profiles"
ON public.user_skill_profiles FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "public_read_public_skill_profiles" ON public.user_skill_profiles;
CREATE POLICY "public_read_public_skill_profiles"
ON public.user_skill_profiles FOR SELECT TO public
USING (is_public = true);

DROP POLICY IF EXISTS "users_manage_own_skill_portfolio_media" ON public.user_skill_portfolio_media;
CREATE POLICY "users_manage_own_skill_portfolio_media"
ON public.user_skill_portfolio_media FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND (p.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND (p.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "public_read_public_skill_portfolio_media" ON public.user_skill_portfolio_media;
CREATE POLICY "public_read_public_skill_portfolio_media"
ON public.user_skill_portfolio_media FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND p.is_public = true
  )
);

DROP POLICY IF EXISTS "users_manage_own_skill_achievements" ON public.user_skill_achievements;
CREATE POLICY "users_manage_own_skill_achievements"
ON public.user_skill_achievements FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND (p.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND (p.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "public_read_public_skill_achievements" ON public.user_skill_achievements;
CREATE POLICY "public_read_public_skill_achievements"
ON public.user_skill_achievements FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.user_skill_profiles p
    WHERE p.id = profile_id
      AND p.is_public = true
  )
);
