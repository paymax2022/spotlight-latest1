-- Stage advancement: move a stage's survivors into the next stage.
--
-- The eviction pipeline built in 20260807000000 goes trigger -> (grace
-- period) -> finalize, and finalize_stage_evictions() correctly flips a
-- finalized contestant's contestant_stage_assignments.status to 'evicted'.
-- But nothing ever moves the OTHER contestants — the ones who were never
-- marked for eviction — into the next stage. Their assignment row just sits
-- at stage_number = N, status = 'active' forever, and contest_stages.status
-- values 'saved' and 'advanced' (declared in the CHECK constraint from day
-- one) are never written by anything. So today the eviction pipeline can
-- knock people OUT of a contest, but nobody can ever be moved forward into
-- stage 2 — the loop the admin console now runs (trigger eviction, finalize)
-- has no way to close.
--
-- advance_stage_survivors(contest_id, stage_number):
--   1. Refuses if stage_number+1 doesn't exist in contest_stages — stage N
--      IS the grand finale, there's nothing to advance into.
--   2. Refuses if any eviction for this stage is still 'pending' (grace
--      period hasn't ended / finalize hasn't run) — advancing now would
--      carry someone forward who might still end up evicted, or fail to
--      carry someone the finalize step is about to evict-in-place.
--   3. Otherwise: every assignment at stage_number still 'active' (i.e. not
--      evicted) is marked 'advanced' and gets a new row at stage_number+1
--      with status 'active'; contestants.current_stage_number follows them.
--
-- New RPC via CREATE OR REPLACE, no existing function altered; additive-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.advance_stage_survivors(
  p_contest_id uuid,
  p_stage_number integer
)
RETURNS TABLE (
  advanced_count integer,
  next_stage_number integer,
  blocked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_stage integer := p_stage_number + 1;
  v_has_next boolean;
  v_pending integer;
  v_advanced integer;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.contest_stages
    WHERE contest_id = p_contest_id AND stage_number = v_next_stage
  ) INTO v_has_next;

  IF NOT v_has_next THEN
    RETURN QUERY SELECT 0, NULL::integer,
      'This is the final stage — there is no next stage to advance survivors into.'::text;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_pending
  FROM public.contestant_evictions
  WHERE contest_id = p_contest_id
    AND stage_number = p_stage_number
    AND status = 'pending';

  IF v_pending > 0 THEN
    RETURN QUERY SELECT 0, v_next_stage,
      format('%s eviction(s) for this stage are still pending — finalize them first.', v_pending);
    RETURN;
  END IF;

  UPDATE public.contestant_stage_assignments
  SET status = 'advanced', updated_at = timezone('utc', now())
  WHERE contest_id = p_contest_id
    AND stage_number = p_stage_number
    AND status = 'active';
  GET DIAGNOSTICS v_advanced = ROW_COUNT;

  INSERT INTO public.contestant_stage_assignments (contestant_id, contest_id, stage_number, status)
  SELECT csa.contestant_id, p_contest_id, v_next_stage, 'active'
  FROM public.contestant_stage_assignments csa
  WHERE csa.contest_id = p_contest_id
    AND csa.stage_number = p_stage_number
    AND csa.status = 'advanced'
  ON CONFLICT (contestant_id, contest_id, stage_number) DO NOTHING;

  UPDATE public.contestants c
  SET current_stage_number = v_next_stage, updated_at = timezone('utc', now())
  WHERE c.contest_id = p_contest_id
    AND c.id IN (
      SELECT contestant_id FROM public.contestant_stage_assignments
      WHERE contest_id = p_contest_id AND stage_number = p_stage_number AND status = 'advanced'
    );

  RETURN QUERY SELECT v_advanced, v_next_stage, NULL::text;
END;
$$;

COMMIT;
