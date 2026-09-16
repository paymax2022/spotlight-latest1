-- ============================================================
-- Judges & Scores admin console (ADMIN CONSOLIDATION, ADR-047 slice 4a):
-- scorecards were kept in a globalThis Map in frontend-web, so every judge
-- score vanished on server restart/redeploy. This gives applicant scoring
-- (keyed by registrations.id) a real, persistent home. Distinct from
-- public.judge_scores (20260410221000_music_judging.sql), which scores
-- competition_entries for the One-Beat-One-Verse flow, not registrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.judge_application_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  judge_name TEXT NOT NULL DEFAULT '',
  contest_slug TEXT NOT NULL DEFAULT '',
  scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  max_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  percentage_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL DEFAULT 'pending'
    CHECK (recommendation IN ('pending', 'shortlist', 'approve', 'reject')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_application_scorecards_unique
  ON public.judge_application_scorecards(application_id, judge_id);

CREATE INDEX IF NOT EXISTS idx_judge_application_scorecards_application
  ON public.judge_application_scorecards(application_id);

CREATE OR REPLACE FUNCTION public.update_judge_application_scorecards_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_judge_application_scorecards_updated_at ON public.judge_application_scorecards;
CREATE TRIGGER set_judge_application_scorecards_updated_at
  BEFORE UPDATE ON public.judge_application_scorecards
  FOR EACH ROW
  EXECUTE FUNCTION public.update_judge_application_scorecards_updated_at();

ALTER TABLE public.judge_application_scorecards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_judge_application_scorecards" ON public.judge_application_scorecards;
CREATE POLICY "admin_manage_judge_application_scorecards"
ON public.judge_application_scorecards FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "judges_read_own_application_scorecards" ON public.judge_application_scorecards;
CREATE POLICY "judges_read_own_application_scorecards"
ON public.judge_application_scorecards FOR SELECT TO authenticated
USING (judge_id = auth.uid() OR public.is_admin());
