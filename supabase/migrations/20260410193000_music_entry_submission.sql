-- ============================================================
-- One-Beat, One-Verse Entry Submission Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.competition_enrollments(id) ON DELETE SET NULL,
  beat_id UUID REFERENCES public.competition_beats(id) ON DELETE SET NULL,
  entry_title TEXT NOT NULL DEFAULT '',
  entry_description TEXT NOT NULL DEFAULT '',
  lyrical_concept_summary TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  media_mode TEXT NOT NULL DEFAULT 'audio',
  video_link TEXT NOT NULL DEFAULT '',
  explicit_content_declared BOOLEAN NOT NULL DEFAULT false,
  originality_confirmed BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  moderation_feedback TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_entries_competition
  ON public.competition_entries(competition_id, status);

CREATE INDEX IF NOT EXISTS idx_competition_entries_user
  ON public.competition_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_competition_entries_status
  ON public.competition_entries(status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.competition_entry_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'audio',
  media_url TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_entry_media_entry
  ON public.competition_entry_media(entry_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_competition_entry_media_type
  ON public.competition_entry_media(media_type);

CREATE OR REPLACE FUNCTION public.update_competition_entries_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_entry_media_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_entries_updated_at ON public.competition_entries;
CREATE TRIGGER set_competition_entries_updated_at
  BEFORE UPDATE ON public.competition_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_entries_updated_at();

DROP TRIGGER IF EXISTS set_competition_entry_media_updated_at ON public.competition_entry_media;
CREATE TRIGGER set_competition_entry_media_updated_at
  BEFORE UPDATE ON public.competition_entry_media
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_entry_media_updated_at();

ALTER TABLE public.competition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entry_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_competition_entries" ON public.competition_entries;
CREATE POLICY "users_read_own_competition_entries"
ON public.competition_entries FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_insert_own_competition_entries" ON public.competition_entries;
CREATE POLICY "users_insert_own_competition_entries"
ON public.competition_entries FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_update_own_competition_entries" ON public.competition_entries;
CREATE POLICY "users_update_own_competition_entries"
ON public.competition_entries FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "public_read_live_competition_entries" ON public.competition_entries;
CREATE POLICY "public_read_live_competition_entries"
ON public.competition_entries FOR SELECT TO public
USING (status IN ('live_for_voting', 'finalist', 'winner'));

DROP POLICY IF EXISTS "users_read_own_entry_media" ON public.competition_entry_media;
CREATE POLICY "users_read_own_entry_media"
ON public.competition_entry_media FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "users_manage_own_entry_media" ON public.competition_entry_media;
CREATE POLICY "users_manage_own_entry_media"
ON public.competition_entry_media FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "public_read_live_entry_media" ON public.competition_entry_media;
CREATE POLICY "public_read_live_entry_media"
ON public.competition_entry_media FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND e.status IN ('live_for_voting', 'finalist', 'winner')
  )
);
