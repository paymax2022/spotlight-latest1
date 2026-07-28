-- Migration: admin-configurable global daily free vote cap
-- Additive only. No drops, no renames.

-- 1. New columns on voting_settings
ALTER TABLE public.voting_settings
  ADD COLUMN IF NOT EXISTS daily_free_vote_cap_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_free_vote_cap         integer DEFAULT NULL;

COMMENT ON COLUMN public.voting_settings.daily_free_vote_cap_enabled
  IS 'When true, free voting stops once daily_free_vote_cap total free votes have been cast for the day.';
COMMENT ON COLUMN public.voting_settings.daily_free_vote_cap
  IS 'Max total free votes allowed across ALL voters per calendar day (UTC). NULL = unlimited.';

-- 2. Table that tracks total free votes cast per contest per day
CREATE TABLE IF NOT EXISTS public.contest_daily_free_vote_totals (
  contest_id      uuid    NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  vote_date       date    NOT NULL,
  free_votes_cast integer NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, vote_date)
);

COMMENT ON TABLE public.contest_daily_free_vote_totals
  IS 'Running total of confirmed free votes cast per contest per UTC calendar day. Enforces the admin global daily cap.';

ALTER TABLE public.contest_daily_free_vote_totals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON public.contest_daily_free_vote_totals
  USING (auth.role() = 'service_role');

-- 3. RPC: atomically claim free votes against the global daily cap.
--    Acquires a row-level lock so two concurrent requests cannot both pass a nearly-full cap.
--    Returns: allowed (bool), votes_claimed (int), cap_remaining (int).
CREATE OR REPLACE FUNCTION public.try_claim_global_free_votes(
  p_contest_id  uuid,
  p_vote_date   date,
  p_quantity    integer,
  p_cap         integer
)
RETURNS TABLE (allowed boolean, votes_claimed integer, cap_remaining integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_before integer;
  v_can    integer;
  v_after  integer;
BEGIN
  -- Ensure a tracking row exists for today
  INSERT INTO public.contest_daily_free_vote_totals (contest_id, vote_date, free_votes_cast)
  VALUES (p_contest_id, p_vote_date, 0)
  ON CONFLICT (contest_id, vote_date) DO NOTHING;

  -- Lock the row so concurrent callers serialize here
  SELECT free_votes_cast INTO v_before
  FROM public.contest_daily_free_vote_totals
  WHERE contest_id = p_contest_id AND vote_date = p_vote_date
  FOR UPDATE;

  IF v_before >= p_cap THEN
    RETURN QUERY SELECT false, 0, 0;
    RETURN;
  END IF;

  -- Claim as many as cap allows (may be fewer than requested if near the cap)
  v_can   := LEAST(p_quantity, p_cap - v_before);
  v_after := v_before + v_can;

  UPDATE public.contest_daily_free_vote_totals
  SET free_votes_cast = v_after
  WHERE contest_id = p_contest_id AND vote_date = p_vote_date;

  RETURN QUERY SELECT true, v_can, (p_cap - v_after);
END;
$$;
