-- ============================================================
-- Reality TV Contest Consolidation
-- Makes Reality TV a first-class contest type inside contests.
-- ============================================================

BEGIN;

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS season_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS season_number INTEGER,
  ADD COLUMN IF NOT EXISTS trailer_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contest_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Keep contest_type values normalized for unified engine.
UPDATE public.contests
SET contest_type = 'reality_tv_show'
WHERE contest_type IN ('reality_tv', 'reality_show');

CREATE TABLE IF NOT EXISTS public.competition_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  round_name TEXT NOT NULL,
  round_code TEXT NOT NULL,
  round_type TEXT NOT NULL DEFAULT 'public_voting',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  judge_weight NUMERIC(6,2) NOT NULL DEFAULT 40,
  public_vote_weight NUMERIC(6,2) NOT NULL DEFAULT 60,
  is_voting_frozen BOOLEAN NOT NULL DEFAULT false,
  auto_elimination_enabled BOOLEAN NOT NULL DEFAULT false,
  elimination_rule TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (competition_id, round_code)
);

CREATE INDEX IF NOT EXISTS idx_comp_rounds_competition
  ON public.competition_rounds(competition_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_comp_rounds_status
  ON public.competition_rounds(status);
CREATE INDEX IF NOT EXISTS idx_contests_type_season
  ON public.contests(contest_type, season_number DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_competition_rounds_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competition_rounds_updated_at ON public.competition_rounds;
CREATE TRIGGER competition_rounds_updated_at
  BEFORE UPDATE ON public.competition_rounds
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_rounds_updated_at();

ALTER TABLE public.competition_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_competition_rounds" ON public.competition_rounds;
CREATE POLICY "admin_manage_competition_rounds"
ON public.competition_rounds FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_competition_rounds" ON public.competition_rounds;
CREATE POLICY "public_read_competition_rounds"
ON public.competition_rounds FOR SELECT TO anon, authenticated
USING (true);

COMMIT;

