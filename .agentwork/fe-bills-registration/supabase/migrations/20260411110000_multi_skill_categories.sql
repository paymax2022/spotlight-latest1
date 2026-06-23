-- ============================================================
-- Multi-Skill Categories Foundation
-- Adds category metadata, category rules, and judging templates.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.skill_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  vertical_group TEXT NOT NULL DEFAULT 'general',
  active BOOLEAN NOT NULL DEFAULT true,
  featured BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_categories_slug_unique
  ON public.skill_categories(slug);

CREATE INDEX IF NOT EXISTS idx_skill_categories_active
  ON public.skill_categories(active, featured, sort_order);

CREATE TABLE IF NOT EXISTS public.skill_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.skill_categories(id) ON DELETE CASCADE,
  entry_type_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_media_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  max_file_size_mb INTEGER NOT NULL DEFAULT 100,
  max_duration_seconds INTEGER NOT NULL DEFAULT 300,
  voting_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  age_min INTEGER,
  age_max INTEGER,
  team_participation_allowed BOOLEAN NOT NULL DEFAULT false,
  custom_onboarding_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  moderation_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  plagiarism_check_enabled BOOLEAN NOT NULL DEFAULT false,
  duplicate_check_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_category_rules_age_check CHECK (
    age_min IS NULL OR age_max IS NULL OR age_min <= age_max
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_category_rules_category_unique
  ON public.skill_category_rules(category_id);

CREATE TABLE IF NOT EXISTS public.skill_category_judging_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.skill_categories(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL DEFAULT 'Default',
  description TEXT NOT NULL DEFAULT '',
  scoring_scale_min NUMERIC(10, 2) NOT NULL DEFAULT 0,
  scoring_scale_max NUMERIC(10, 2) NOT NULL DEFAULT 10,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT skill_category_judging_templates_scale_check CHECK (scoring_scale_max > scoring_scale_min)
);

CREATE INDEX IF NOT EXISTS idx_skill_category_judging_templates_category
  ON public.skill_category_judging_templates(category_id, is_active);

CREATE OR REPLACE FUNCTION public.update_skill_categories_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_skill_categories_updated_at ON public.skill_categories;
CREATE TRIGGER set_skill_categories_updated_at
  BEFORE UPDATE ON public.skill_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_skill_categories_updated_at();

DROP TRIGGER IF EXISTS set_skill_category_rules_updated_at ON public.skill_category_rules;
CREATE TRIGGER set_skill_category_rules_updated_at
  BEFORE UPDATE ON public.skill_category_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_skill_categories_updated_at();

DROP TRIGGER IF EXISTS set_skill_category_judging_templates_updated_at ON public.skill_category_judging_templates;
CREATE TRIGGER set_skill_category_judging_templates_updated_at
  BEFORE UPDATE ON public.skill_category_judging_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_skill_categories_updated_at();

ALTER TABLE public.skill_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_category_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_category_judging_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_skill_categories" ON public.skill_categories;
CREATE POLICY "public_read_skill_categories"
ON public.skill_categories FOR SELECT TO public
USING (active = true);

DROP POLICY IF EXISTS "admin_manage_skill_categories" ON public.skill_categories;
CREATE POLICY "admin_manage_skill_categories"
ON public.skill_categories FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_skill_category_rules" ON public.skill_category_rules;
CREATE POLICY "public_read_skill_category_rules"
ON public.skill_category_rules FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.skill_categories c
    WHERE c.id = category_id
      AND c.active = true
  )
);

DROP POLICY IF EXISTS "admin_manage_skill_category_rules" ON public.skill_category_rules;
CREATE POLICY "admin_manage_skill_category_rules"
ON public.skill_category_rules FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_skill_category_judging_templates" ON public.skill_category_judging_templates;
CREATE POLICY "public_read_skill_category_judging_templates"
ON public.skill_category_judging_templates FOR SELECT TO public
USING (
  is_active = true
  AND EXISTS (
    SELECT 1
    FROM public.skill_categories c
    WHERE c.id = category_id
      AND c.active = true
  )
);

DROP POLICY IF EXISTS "admin_manage_skill_category_judging_templates" ON public.skill_category_judging_templates;
CREATE POLICY "admin_manage_skill_category_judging_templates"
ON public.skill_category_judging_templates FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
