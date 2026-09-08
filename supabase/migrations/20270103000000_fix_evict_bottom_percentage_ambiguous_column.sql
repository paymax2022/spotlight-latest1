-- Fix evict_bottom_percentage: "column reference vote_count is ambiguous".
--
-- 20260807000000_voting_contest_stages_eviction.sql's RETURN QUERY built the
-- eviction rows through a data-modifying CTE whose RETURNING list (id,
-- contestant_id, vote_count, eviction_rank) collided with the SAME column
-- names projected by the sibling ranked_contestants CTE earlier in the same
-- WITH block. Postgres cannot disambiguate a bare column name against two
-- range tables visible in one WITH query, even though RETURNING only
-- targets contestant_evictions — so every call raised "column reference
-- \"vote_count\" is ambiguous" and TriggerEvictions (POST .../stages/:n/evict)
-- 500'd on every attempt, surfaced to the admin as the generic "vote failed"
-- (connect/voting's shared mapError has no branch for this — see
-- backend/internal/connect/voting/handlers.go). Never worked: no caller in
-- this repo exercised the RPC directly until the admin "Run eviction" action
-- was wired up.
--
-- Fix: rename ranked_contestants' columns (vote_count -> vc, eviction_rank ->
-- erank) so no name collides, and fully qualify the RETURNING list with the
-- target table. Same logic, same signature, same return shape — only the
-- internal aliasing changes. CREATE OR REPLACE, not a DROP; additive-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.evict_bottom_percentage(
  p_contest_id uuid,
  p_stage_number integer,
  p_eviction_percentage integer DEFAULT 20,
  p_grace_period_hours integer DEFAULT 24,
  p_triggered_by uuid DEFAULT NULL
)
RETURNS TABLE (
  evicted_contestant_id uuid,
  vote_count integer,
  eviction_rank integer,
  eviction_record_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_contestants integer;
  v_to_evict integer;
  v_current_user_id uuid;
  v_grace_period_end timestamptz;
BEGIN
  v_current_user_id := COALESCE(p_triggered_by, auth.uid());
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to trigger evictions';
  END IF;

  v_grace_period_end := timezone('utc', now()) + (p_grace_period_hours || ' hours')::interval;

  SELECT COUNT(*) INTO v_total_contestants
  FROM public.contestant_stage_assignments csa
  WHERE csa.contest_id = p_contest_id
    AND csa.stage_number = p_stage_number
    AND csa.status = 'active';

  v_to_evict := GREATEST(1, CEIL(v_total_contestants * p_eviction_percentage / 100.0)::integer);

  RETURN QUERY
  WITH ranked_contestants AS (
    SELECT
      csa.id,
      csa.contestant_id,
      COALESCE(vt.total_confirmed_votes, 0) as vc,
      ROW_NUMBER() OVER (ORDER BY COALESCE(vt.total_confirmed_votes, 0) ASC, csa.created_at DESC) as erank
    FROM public.contestant_stage_assignments csa
    LEFT JOIN public.vote_totals vt
      ON vt.contestant_id = csa.contestant_id
      AND vt.contest_id = p_contest_id
    WHERE csa.contest_id = p_contest_id
      AND csa.stage_number = p_stage_number
      AND csa.status = 'active'
    ORDER BY vc ASC, csa.created_at DESC
    LIMIT v_to_evict
  ),
  inserted_evictions AS (
    INSERT INTO public.contestant_evictions (
      contestant_id,
      contest_id,
      stage_number,
      triggered_by,
      trigger_type,
      vote_count,
      eviction_rank,
      grace_period_starts_at,
      grace_period_ends_at,
      status,
      reason
    )
    SELECT
      rc.contestant_id,
      p_contest_id,
      p_stage_number,
      v_current_user_id,
      'admin',
      rc.vc,
      rc.erank,
      timezone('utc', now()),
      v_grace_period_end,
      'pending',
      'Bottom ' || p_eviction_percentage || '% by vote count'
    FROM ranked_contestants rc
    RETURNING contestant_evictions.id, contestant_evictions.contestant_id,
              contestant_evictions.vote_count, contestant_evictions.eviction_rank
  )
  SELECT
    ie.contestant_id,
    ie.vote_count,
    ie.eviction_rank,
    ie.id
  FROM inserted_evictions ie;
END;
$$;

COMMIT;
