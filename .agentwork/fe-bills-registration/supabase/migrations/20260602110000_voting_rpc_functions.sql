-- =============================================================================
-- VOTING ENGINE — Postgres RPC functions for atomic vote operations
-- Migration: 20260602110000_voting_rpc_functions
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- increment_vote_totals
-- Atomically upserts the vote_totals row and increments all delta counters.
-- Uses INSERT ... ON CONFLICT DO UPDATE for true atomicity without locking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_vote_totals(
  p_contest_id            uuid,
  p_contestant_id         uuid,
  p_round_id              uuid,
  p_free_votes            bigint DEFAULT 0,
  p_paid_votes            bigint DEFAULT 0,
  p_bonus_votes           bigint DEFAULT 0,
  p_admin_adjustment_votes bigint DEFAULT 0,
  p_reversed_votes        bigint DEFAULT 0,
  p_quarantined_votes     bigint DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.vote_totals (
    contest_id, contestant_id, round_id,
    free_votes, paid_votes, bonus_votes,
    admin_adjustment_votes, reversed_votes, quarantined_votes,
    total_confirmed_votes,
    last_vote_at, updated_at
  )
  VALUES (
    p_contest_id, p_contestant_id, p_round_id,
    GREATEST(0, p_free_votes),
    GREATEST(0, p_paid_votes),
    GREATEST(0, p_bonus_votes),
    p_admin_adjustment_votes,
    GREATEST(0, p_reversed_votes),
    GREATEST(0, p_quarantined_votes),
    GREATEST(0,
      p_free_votes + p_paid_votes + p_bonus_votes +
      p_admin_adjustment_votes - p_reversed_votes
    ),
    CASE WHEN (p_free_votes + p_paid_votes + p_bonus_votes) > 0 THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (contest_id, contestant_id, round_id) DO UPDATE SET
    free_votes              = GREATEST(0, vote_totals.free_votes + EXCLUDED.free_votes),
    paid_votes              = GREATEST(0, vote_totals.paid_votes + EXCLUDED.paid_votes),
    bonus_votes             = GREATEST(0, vote_totals.bonus_votes + EXCLUDED.bonus_votes),
    admin_adjustment_votes  = vote_totals.admin_adjustment_votes + EXCLUDED.admin_adjustment_votes,
    reversed_votes          = GREATEST(0, vote_totals.reversed_votes + EXCLUDED.reversed_votes),
    quarantined_votes       = GREATEST(0, vote_totals.quarantined_votes + EXCLUDED.quarantined_votes),
    total_confirmed_votes   = GREATEST(0,
      (vote_totals.free_votes + EXCLUDED.free_votes) +
      (vote_totals.paid_votes + EXCLUDED.paid_votes) +
      (vote_totals.bonus_votes + EXCLUDED.bonus_votes) +
      (vote_totals.admin_adjustment_votes + EXCLUDED.admin_adjustment_votes) -
      (vote_totals.reversed_votes + EXCLUDED.reversed_votes)
    ),
    last_vote_at = CASE
      WHEN (EXCLUDED.free_votes + EXCLUDED.paid_votes + EXCLUDED.bonus_votes) > 0
      THEN now()
      ELSE vote_totals.last_vote_at
    END,
    updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- recompute_leaderboard_ranks
-- Assigns integer ranks to all contestants in a contest using RANK() OVER.
-- Tie-breaker: higher paid_votes wins; then earlier last_vote_at wins.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_leaderboard_ranks(
  p_contest_id uuid,
  p_round_id   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.vote_totals AS vt
  SET rank = ranked.new_rank,
      updated_at = now()
  FROM (
    SELECT
      id,
      RANK() OVER (
        ORDER BY
          total_confirmed_votes DESC,
          paid_votes DESC,
          last_vote_at ASC NULLS LAST
      ) AS new_rank
    FROM public.vote_totals
    WHERE contest_id = p_contest_id
      AND (p_round_id IS NULL OR round_id = p_round_id)
  ) AS ranked
  WHERE vt.id = ranked.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- increment_share_click
-- Atomically increments click_count on a contestant_share_links row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_share_click(
  p_share_link_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.contestant_share_links
  SET click_count = click_count + 1,
      updated_at  = now()
  WHERE id = p_share_link_id;
END;
$$;

-- Grant execute to service_role (used by API layer) and anon (for share clicks)
GRANT EXECUTE ON FUNCTION public.increment_vote_totals TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_leaderboard_ranks TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_share_click TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_share_click TO anon;
GRANT EXECUTE ON FUNCTION public.increment_share_click TO authenticated;

COMMIT;
