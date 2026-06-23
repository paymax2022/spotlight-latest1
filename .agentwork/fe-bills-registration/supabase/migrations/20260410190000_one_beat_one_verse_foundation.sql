-- ============================================================
-- One-Beat, One-Verse Foundation
-- Extends existing contests and adds core music competition entities
-- ============================================================

-- 1) Extend contests with music-competition metadata
ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS contest_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_scope TEXT NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS age_min INTEGER,
  ADD COLUMN IF NOT EXISTS age_max INTEGER,
  ADD COLUMN IF NOT EXISTS genre_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS max_entries_per_user INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shortlisting_limit INTEGER,
  ADD COLUMN IF NOT EXISTS judge_weight NUMERIC(5, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN IF NOT EXISTS public_vote_weight NUMERIC(5, 2) NOT NULL DEFAULT 60.00,
  ADD COLUMN IF NOT EXISTS entry_fee_ngn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vote_price_ngn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rules_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS eligibility_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sponsor_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prize_structure JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill slug for existing contests
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate_slug TEXT;
  seq_num INTEGER;
BEGIN
  FOR rec IN
    SELECT id, name
    FROM public.contests
    WHERE slug IS NULL OR btrim(slug) = ''
  LOOP
    base_slug := lower(regexp_replace(rec.name, '[^a-zA-Z0-9\s-]', '', 'g'));
    base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
    base_slug := trim(both '-' from base_slug);
    IF base_slug = '' THEN
      base_slug := 'competition';
    END IF;

    candidate_slug := base_slug;
    seq_num := 1;

    WHILE EXISTS (
      SELECT 1 FROM public.contests c WHERE c.slug = candidate_slug AND c.id <> rec.id
    ) LOOP
      seq_num := seq_num + 1;
      candidate_slug := base_slug || '-' || seq_num::TEXT;
    END LOOP;

    UPDATE public.contests
    SET slug = candidate_slug
    WHERE id = rec.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_slug_unique
  ON public.contests(slug)
  WHERE slug IS NOT NULL AND btrim(slug) <> '';

CREATE INDEX IF NOT EXISTS idx_contests_type_status
  ON public.contests(contest_type, status);

CREATE INDEX IF NOT EXISTS idx_contests_featured
  ON public.contests(is_featured)
  WHERE is_featured = true;

-- 2) Competition stage windows
CREATE TABLE IF NOT EXISTS public.competition_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_hard_lock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_windows_competition_stage
  ON public.competition_windows(competition_id, stage);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_windows_stage_unique
  ON public.competition_windows(competition_id, stage);

-- 3) Competition beats
CREATE TABLE IF NOT EXISTS public.competition_beats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  producer_credit TEXT NOT NULL DEFAULT '',
  sponsor_tag TEXT NOT NULL DEFAULT '',
  preview_url TEXT NOT NULL DEFAULT '',
  download_url TEXT NOT NULL DEFAULT '',
  rules_text TEXT NOT NULL DEFAULT '',
  requires_enrollment BOOLEAN NOT NULL DEFAULT true,
  allow_multiple_choice BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_beats_competition
  ON public.competition_beats(competition_id);

CREATE INDEX IF NOT EXISTS idx_competition_beats_active
  ON public.competition_beats(competition_id, is_active);

-- 4) Beat download logs
CREATE TABLE IF NOT EXISTS public.beat_download_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beat_id UUID NOT NULL REFERENCES public.competition_beats(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_beat_download_logs_beat
  ON public.beat_download_logs(beat_id, downloaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_beat_download_logs_user
  ON public.beat_download_logs(user_id, downloaded_at DESC);

-- 5) Competition enrollments
CREATE TABLE IF NOT EXISTS public.competition_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL DEFAULT '',
  legal_name TEXT NOT NULL DEFAULT '',
  date_of_birth DATE,
  gender TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  genre_style TEXT NOT NULL DEFAULT '',
  short_bio TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  epk JSONB NOT NULL DEFAULT '{}'::jsonb,
  profile_photo_url TEXT NOT NULL DEFAULT '',
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  consent_accepted BOOLEAN NOT NULL DEFAULT false,
  eligibility_confirmed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'enrolled',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_enrollments_unique
  ON public.competition_enrollments(competition_id, user_id);

CREATE INDEX IF NOT EXISTS idx_competition_enrollments_competition
  ON public.competition_enrollments(competition_id, status);

-- 6) Updated-at helpers
CREATE OR REPLACE FUNCTION public.update_competition_windows_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_beats_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_enrollments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_windows_updated_at ON public.competition_windows;
CREATE TRIGGER set_competition_windows_updated_at
  BEFORE UPDATE ON public.competition_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_windows_updated_at();

DROP TRIGGER IF EXISTS set_competition_beats_updated_at ON public.competition_beats;
CREATE TRIGGER set_competition_beats_updated_at
  BEFORE UPDATE ON public.competition_beats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_beats_updated_at();

DROP TRIGGER IF EXISTS set_competition_enrollments_updated_at ON public.competition_enrollments;
CREATE TRIGGER set_competition_enrollments_updated_at
  BEFORE UPDATE ON public.competition_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_enrollments_updated_at();

-- 7) RLS
ALTER TABLE public.competition_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beat_download_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_competition_windows" ON public.competition_windows;
CREATE POLICY "public_read_competition_windows"
ON public.competition_windows FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_competition_windows" ON public.competition_windows;
CREATE POLICY "admin_manage_competition_windows"
ON public.competition_windows FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_competition_beats" ON public.competition_beats;
CREATE POLICY "public_read_competition_beats"
ON public.competition_beats FOR SELECT TO public USING (is_active = true);

DROP POLICY IF EXISTS "admin_manage_competition_beats" ON public.competition_beats;
CREATE POLICY "admin_manage_competition_beats"
ON public.competition_beats FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_insert_beat_download_logs" ON public.beat_download_logs;
CREATE POLICY "users_insert_beat_download_logs"
ON public.beat_download_logs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_read_beat_download_logs" ON public.beat_download_logs;
CREATE POLICY "admin_read_beat_download_logs"
ON public.beat_download_logs FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_competition_enrollments" ON public.competition_enrollments;
CREATE POLICY "users_read_own_competition_enrollments"
ON public.competition_enrollments FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_insert_own_competition_enrollments" ON public.competition_enrollments;
CREATE POLICY "users_insert_own_competition_enrollments"
ON public.competition_enrollments FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_update_own_competition_enrollments" ON public.competition_enrollments;
CREATE POLICY "users_update_own_competition_enrollments"
ON public.competition_enrollments FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());
