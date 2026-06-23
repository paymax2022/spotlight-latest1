-- ============================================================
-- Music Growth Features
-- Adds: competition promotions, sponsor slots, talent pipeline records
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'music_promo_status'
  ) THEN
    CREATE TYPE public.music_promo_status AS ENUM ('draft', 'active', 'paused', 'completed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'music_pipeline_status'
  ) THEN
    CREATE TYPE public.music_pipeline_status AS ENUM ('new', 'contacted', 'in_review', 'signed', 'archived');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.competition_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  promo_type TEXT NOT NULL DEFAULT 'profile_boost',
  placement TEXT NOT NULL DEFAULT 'homepage_featured',
  status public.music_promo_status NOT NULL DEFAULT 'draft',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  budget_ngn INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_promotions_competition_id
  ON public.competition_promotions(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_promotions_status
  ON public.competition_promotions(status);
CREATE INDEX IF NOT EXISTS idx_competition_promotions_entry_id
  ON public.competition_promotions(entry_id);

CREATE TABLE IF NOT EXISTS public.competition_sponsor_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  sponsor_name TEXT NOT NULL DEFAULT '',
  asset_url TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  placement TEXT NOT NULL DEFAULT 'hero',
  impression_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_sponsor_slots_competition_id
  ON public.competition_sponsor_slots(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_sponsor_slots_active
  ON public.competition_sponsor_slots(is_active);

CREATE TABLE IF NOT EXISTS public.talent_pipeline_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  enrollment_id UUID REFERENCES public.competition_enrollments(id) ON DELETE SET NULL,
  stage_name TEXT NOT NULL DEFAULT '',
  status public.music_pipeline_status NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  owner_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  last_contacted_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_talent_pipeline_records_competition_id
  ON public.talent_pipeline_records(competition_id);
CREATE INDEX IF NOT EXISTS idx_talent_pipeline_records_status
  ON public.talent_pipeline_records(status);
CREATE INDEX IF NOT EXISTS idx_talent_pipeline_records_entry_id
  ON public.talent_pipeline_records(entry_id);

CREATE OR REPLACE FUNCTION public.update_music_growth_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_promotions_updated_at ON public.competition_promotions;
CREATE TRIGGER set_competition_promotions_updated_at
  BEFORE UPDATE ON public.competition_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_music_growth_updated_at();

DROP TRIGGER IF EXISTS set_competition_sponsor_slots_updated_at ON public.competition_sponsor_slots;
CREATE TRIGGER set_competition_sponsor_slots_updated_at
  BEFORE UPDATE ON public.competition_sponsor_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_music_growth_updated_at();

DROP TRIGGER IF EXISTS set_talent_pipeline_records_updated_at ON public.talent_pipeline_records;
CREATE TRIGGER set_talent_pipeline_records_updated_at
  BEFORE UPDATE ON public.talent_pipeline_records
  FOR EACH ROW EXECUTE FUNCTION public.update_music_growth_updated_at();

ALTER TABLE public.competition_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_sponsor_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_pipeline_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_competition_promotions" ON public.competition_promotions;
CREATE POLICY "admin_manage_competition_promotions"
ON public.competition_promotions
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_active_competition_promotions" ON public.competition_promotions;
CREATE POLICY "public_read_active_competition_promotions"
ON public.competition_promotions
FOR SELECT
TO public
USING (status = 'active');

DROP POLICY IF EXISTS "admin_manage_competition_sponsor_slots" ON public.competition_sponsor_slots;
CREATE POLICY "admin_manage_competition_sponsor_slots"
ON public.competition_sponsor_slots
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_active_competition_sponsor_slots" ON public.competition_sponsor_slots;
CREATE POLICY "public_read_active_competition_sponsor_slots"
ON public.competition_sponsor_slots
FOR SELECT
TO public
USING (is_active = true);

DROP POLICY IF EXISTS "admin_manage_talent_pipeline_records" ON public.talent_pipeline_records;
CREATE POLICY "admin_manage_talent_pipeline_records"
ON public.talent_pipeline_records
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
