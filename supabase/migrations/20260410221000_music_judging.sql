-- ============================================================
-- One-Beat, One-Verse Judge Scoring Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS public.judge_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_assignments_unique
  ON public.judge_assignments(competition_id, judge_id, category);

CREATE INDEX IF NOT EXISTS idx_judge_assignments_judge
  ON public.judge_assignments(judge_id, competition_id);

CREATE TABLE IF NOT EXISTS public.judge_criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  weight NUMERIC(6, 2) NOT NULL DEFAULT 1,
  max_score NUMERIC(6, 2) NOT NULL DEFAULT 10,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_judge_criteria_competition_order
  ON public.judge_criteria(competition_id, sort_order);

CREATE TABLE IF NOT EXISTS public.judge_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  judge_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  criteria_scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_score NUMERIC(10, 4) NOT NULL DEFAULT 0,
  public_note TEXT NOT NULL DEFAULT '',
  private_note TEXT NOT NULL DEFAULT '',
  is_finalized BOOLEAN NOT NULL DEFAULT false,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_judge_scores_unique
  ON public.judge_scores(competition_id, entry_id, judge_id);

CREATE INDEX IF NOT EXISTS idx_judge_scores_entry
  ON public.judge_scores(entry_id, is_finalized);

CREATE INDEX IF NOT EXISTS idx_judge_scores_judge
  ON public.judge_scores(judge_id, competition_id);

CREATE OR REPLACE FUNCTION public.update_judge_assignments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_judge_criteria_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_judge_scores_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_judge_assignments_updated_at ON public.judge_assignments;
CREATE TRIGGER set_judge_assignments_updated_at
  BEFORE UPDATE ON public.judge_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_judge_assignments_updated_at();

DROP TRIGGER IF EXISTS set_judge_criteria_updated_at ON public.judge_criteria;
CREATE TRIGGER set_judge_criteria_updated_at
  BEFORE UPDATE ON public.judge_criteria
  FOR EACH ROW
  EXECUTE FUNCTION public.update_judge_criteria_updated_at();

DROP TRIGGER IF EXISTS set_judge_scores_updated_at ON public.judge_scores;
CREATE TRIGGER set_judge_scores_updated_at
  BEFORE UPDATE ON public.judge_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_judge_scores_updated_at();

ALTER TABLE public.judge_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_judge_assignments" ON public.judge_assignments;
CREATE POLICY "admin_manage_judge_assignments"
ON public.judge_assignments FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "judges_read_own_assignments" ON public.judge_assignments;
CREATE POLICY "judges_read_own_assignments"
ON public.judge_assignments FOR SELECT TO authenticated
USING (judge_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_judge_criteria" ON public.judge_criteria;
CREATE POLICY "admin_manage_judge_criteria"
ON public.judge_criteria FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "judges_read_judge_criteria" ON public.judge_criteria;
CREATE POLICY "judges_read_judge_criteria"
ON public.judge_criteria FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "admin_manage_judge_scores" ON public.judge_scores;
CREATE POLICY "admin_manage_judge_scores"
ON public.judge_scores FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "judges_manage_own_scores" ON public.judge_scores;
CREATE POLICY "judges_manage_own_scores"
ON public.judge_scores FOR ALL TO authenticated
USING (judge_id = auth.uid() OR public.is_admin())
WITH CHECK (judge_id = auth.uid() OR public.is_admin());
