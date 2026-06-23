-- ============================================================
-- One-Beat, One-Verse Entry Ranking Fields
-- ============================================================

ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS public_vote_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS judge_score NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS leaderboard_score NUMERIC(10, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_competition_entries_public_vote_count
  ON public.competition_entries(competition_id, public_vote_count DESC);

CREATE INDEX IF NOT EXISTS idx_competition_entries_leaderboard_score
  ON public.competition_entries(competition_id, leaderboard_score DESC);
