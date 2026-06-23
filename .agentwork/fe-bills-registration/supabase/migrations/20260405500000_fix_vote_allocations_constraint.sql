-- ============================================================
-- Fix vote_allocations unique constraint
-- Replaces ON CONFLICT ON CONSTRAINT (incompatible with expression
-- indexes) with a manual SELECT + INSERT/UPDATE upsert pattern.
-- ============================================================

-- Step 1: Ensure the unique expression index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vote_allocations_unique
  ON public.vote_allocations(COALESCE(user_id::text, ''), device_fingerprint, contestant_id, vote_date);

-- Step 2: Re-create cast_free_vote without ON CONFLICT ON CONSTRAINT
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
BEGIN
  -- Check if vote is allowed
  v_check := public.check_free_vote_allowed(p_user_id, p_device_fingerprint, p_contestant_id);

  IF NOT (v_check->>'allowed')::boolean THEN
    RETURN v_check;
  END IF;

  -- Get contest_id
  SELECT contest_id INTO v_contest_id FROM public.contestants WHERE id = p_contestant_id;

  -- Insert vote record
  INSERT INTO public.contestant_votes (
    contestant_id, contest_id, user_id, voter_ip,
    voter_fingerprint, device_fingerprint, vote_type, vote_count
  ) VALUES (
    p_contestant_id, v_contest_id, p_user_id, p_voter_ip,
    p_device_fingerprint, p_device_fingerprint, 'free', 1
  )
  RETURNING id INTO v_vote_id;

  -- Normalise values matching the unique index expression
  v_coalesced_user_id := COALESCE(p_user_id::text, '');
  v_fingerprint       := COALESCE(p_device_fingerprint, '');

  -- Manual upsert: avoid ON CONFLICT ON CONSTRAINT which requires a
  -- named table constraint, not an expression index.
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
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_alloc_id;
  ELSE
    INSERT INTO public.vote_allocations (
      user_id, device_fingerprint, contest_id, contestant_id,
      vote_date, free_votes_used, free_votes_limit
    ) VALUES (
      p_user_id, v_fingerprint, v_contest_id, p_contestant_id,
      CURRENT_DATE, 1, 3
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'vote_id', v_vote_id,
    'vote_type', 'free',
    'message', 'Free vote cast successfully!'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'reason', SQLERRM);
END;
$$;
