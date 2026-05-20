-- ============================================================
-- One-Beat, One-Verse Voting Engine Extension
-- ============================================================

CREATE TABLE IF NOT EXISTS public.competition_entry_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  voter_ip TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  vote_type TEXT NOT NULL DEFAULT 'free',
  vote_count INTEGER NOT NULL DEFAULT 1,
  payment_reference TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competition_entry_votes_entry_created
  ON public.competition_entry_votes(entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_competition_entry_votes_competition_created
  ON public.competition_entry_votes(competition_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_competition_entry_votes_user_created
  ON public.competition_entry_votes(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_entry_votes_payment_reference
  ON public.competition_entry_votes(payment_reference)
  WHERE payment_reference <> '';

CREATE TABLE IF NOT EXISTS public.competition_entry_vote_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL DEFAULT '',
  vote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  free_votes_used INTEGER NOT NULL DEFAULT 0,
  free_votes_limit INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comp_entry_vote_alloc_unique
  ON public.competition_entry_vote_allocations(
    entry_id,
    vote_date,
    COALESCE(user_id::TEXT, ''),
    device_fingerprint
  );

CREATE INDEX IF NOT EXISTS idx_comp_entry_vote_alloc_user_date
  ON public.competition_entry_vote_allocations(user_id, vote_date);

CREATE INDEX IF NOT EXISTS idx_comp_entry_vote_alloc_entry_date
  ON public.competition_entry_vote_allocations(entry_id, vote_date);

CREATE OR REPLACE FUNCTION public.update_competition_entry_vote_allocations_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_entry_vote_allocations_updated_at ON public.competition_entry_vote_allocations;
CREATE TRIGGER set_competition_entry_vote_allocations_updated_at
  BEFORE UPDATE ON public.competition_entry_vote_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_entry_vote_allocations_updated_at();

ALTER TABLE public.competition_entry_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_entry_vote_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_competition_entry_votes" ON public.competition_entry_votes;
CREATE POLICY "public_read_competition_entry_votes"
ON public.competition_entry_votes FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "authenticated_insert_competition_entry_votes" ON public.competition_entry_votes;
CREATE POLICY "authenticated_insert_competition_entry_votes"
ON public.competition_entry_votes FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR user_id IS NULL OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_competition_entry_votes" ON public.competition_entry_votes;
CREATE POLICY "admin_manage_competition_entry_votes"
ON public.competition_entry_votes FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated_read_competition_entry_vote_allocations" ON public.competition_entry_vote_allocations;
CREATE POLICY "authenticated_read_competition_entry_vote_allocations"
ON public.competition_entry_vote_allocations FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "authenticated_manage_competition_entry_vote_allocations" ON public.competition_entry_vote_allocations;
CREATE POLICY "authenticated_manage_competition_entry_vote_allocations"
ON public.competition_entry_vote_allocations FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());
