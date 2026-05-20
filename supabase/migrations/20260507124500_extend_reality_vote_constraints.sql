-- ============================================================
-- Extend contestant free-vote enforcement to use contest-level limits.
-- This ensures /vote/[slug] honors admin-configured max_votes_per_user.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_free_vote_allowed(
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_contestant_id UUID,
  p_vote_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_allocation RECORD;
  v_contest_status TEXT;
  v_contestant_status TEXT;
  v_contest_id UUID;
  v_voting_enabled BOOLEAN;
  v_limit INTEGER := 3;
  v_used INTEGER := 0;
BEGIN
  SELECT c.status, c.contest_id, co.status, co.voting_enabled, co.max_votes_per_user
  INTO v_contestant_status, v_contest_id, v_contest_status, v_voting_enabled, v_limit
  FROM public.contestants c
  LEFT JOIN public.contests co ON c.contest_id = co.id
  WHERE c.id = p_contestant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contestant not found');
  END IF;

  IF v_contest_status = 'ended' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contest has ended. Voting is locked.');
  END IF;

  IF v_voting_enabled = false THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Voting is currently disabled for this contest.');
  END IF;

  IF v_contestant_status NOT IN ('active', 'approved') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Contestant is not eligible for voting');
  END IF;

  IF v_limit IS NULL OR v_limit <= 0 THEN
    v_limit := 3;
  END IF;

  SELECT * INTO v_allocation
  FROM public.vote_allocations
  WHERE contestant_id = p_contestant_id
    AND vote_date = p_vote_date
    AND (
      (p_user_id IS NOT NULL AND user_id = p_user_id)
      OR (p_user_id IS NULL AND device_fingerprint = p_device_fingerprint)
    )
  LIMIT 1;

  IF FOUND THEN
    v_used := COALESCE(v_allocation.free_votes_used, 0);
  END IF;

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Daily free vote limit reached. Come back tomorrow or use paid votes.',
      'votes_used', v_used,
      'votes_limit', v_limit,
      'votes_remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'votes_used', v_used,
    'votes_limit', v_limit,
    'votes_remaining', GREATEST(v_limit - v_used, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_free_vote(
  p_contestant_id UUID,
  p_user_id UUID,
  p_device_fingerprint TEXT,
  p_voter_ip TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_check             JSONB;
  v_contest_id        UUID;
  v_vote_id           UUID;
  v_coalesced_user_id TEXT;
  v_fingerprint       TEXT;
  v_alloc_id          UUID;
  v_limit             INTEGER := 3;
BEGIN
  v_check := public.check_free_vote_allowed(p_user_id, p_device_fingerprint, p_contestant_id);

  IF NOT COALESCE((v_check->>'allowed')::boolean, false) THEN
    RETURN v_check;
  END IF;

  SELECT c.contest_id, co.max_votes_per_user
  INTO v_contest_id, v_limit
  FROM public.contestants c
  LEFT JOIN public.contests co ON c.contest_id = co.id
  WHERE c.id = p_contestant_id;

  IF v_limit IS NULL OR v_limit <= 0 THEN
    v_limit := 3;
  END IF;

  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, voter_ip,
    voter_fingerprint, device_fingerprint, vote_type, vote_count
  ) VALUES (
    p_contestant_id, v_contest_id, p_user_id, p_voter_ip,
    p_device_fingerprint, p_device_fingerprint, 'free', 1
  )
  RETURNING id INTO v_vote_id;

  v_coalesced_user_id := COALESCE(p_user_id::text, '');
  v_fingerprint := COALESCE(p_device_fingerprint, '');

  SELECT id INTO v_alloc_id
  FROM public.vote_allocations
  WHERE COALESCE(user_id::text, '') = v_coalesced_user_id
    AND device_fingerprint = v_fingerprint
    AND contestant_id = p_contestant_id
    AND vote_date = CURRENT_DATE
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.vote_allocations
    SET free_votes_used = free_votes_used + 1,
        free_votes_limit = v_limit,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_alloc_id;
  ELSE
    INSERT INTO public.vote_allocations (
      user_id, device_fingerprint, contest_id, contestant_id,
      vote_date, free_votes_used, free_votes_limit
    ) VALUES (
      p_user_id, v_fingerprint, v_contest_id, p_contestant_id,
      CURRENT_DATE, 1, v_limit
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'free',
    'votes_limit', v_limit,
    'message', 'Free vote cast successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;
