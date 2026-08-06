-- Voting Contest Stages & Eviction System
-- Implements multi-stage contests with contestant eviction and judge save mechanics
-- Created: 2026-08-07

BEGIN;

-- ============================================================================
-- CONTEST_STAGES: Define stages within a contest
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contest_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage_number integer NOT NULL CHECK (stage_number > 0),
  stage_name text NOT NULL,
  stage_description text,

  -- Eviction rules
  eviction_percentage integer NOT NULL DEFAULT 20 CHECK (eviction_percentage > 0 AND eviction_percentage < 100),
  min_contestants_to_evict integer NOT NULL DEFAULT 1,

  -- Stage timing
  voting_starts_at timestamptz,
  voting_ends_at timestamptz,

  -- Configuration
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  UNIQUE(contest_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_contest_stages_contest_id ON public.contest_stages(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_stages_active ON public.contest_stages(is_active);

-- ============================================================================
-- CONTESTANT_STAGE_ASSIGNMENTS: Tracks which stage each contestant is in
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contestant_stage_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id uuid NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,

  -- Status tracking
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'evicted', 'saved', 'advanced')),

  -- Eviction tracking
  evicted_at timestamptz,
  evicted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Save tracking (for future use if needed)
  saved_at timestamptz,
  saved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  UNIQUE(contestant_id, contest_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_contestant_stage_assignments_contestant ON public.contestant_stage_assignments(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_stage_assignments_contest ON public.contestant_stage_assignments(contest_id);
CREATE INDEX IF NOT EXISTS idx_contestant_stage_assignments_stage ON public.contestant_stage_assignments(contest_id, stage_number);
CREATE INDEX IF NOT EXISTS idx_contestant_stage_assignments_status ON public.contestant_stage_assignments(status);

-- ============================================================================
-- CONTESTANT_EVICTIONS: Immutable audit log of evictions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contestant_evictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id uuid NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,

  -- Who triggered the eviction
  triggered_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'admin' CHECK (trigger_type IN ('admin', 'automatic', 'system')),

  -- Vote count at time of eviction
  vote_count integer NOT NULL DEFAULT 0,
  eviction_rank integer,  -- contestant's rank when evicted (e.g., 451st = last in bottom 20%)

  -- Grace period
  grace_period_starts_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  grace_period_ends_at timestamptz NOT NULL,
  grace_period_extended_at timestamptz,
  grace_period_extended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  original_grace_period_ends_at timestamptz,  -- Track original end time if extended

  -- Resolution
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'saved', 'finalized')),
  resolved_at timestamptz,

  reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_contestant_evictions_contestant ON public.contestant_evictions(contestant_id);
CREATE INDEX IF NOT EXISTS idx_contestant_evictions_contest_stage ON public.contestant_evictions(contest_id, stage_number);
CREATE INDEX IF NOT EXISTS idx_contestant_evictions_status ON public.contestant_evictions(status);
CREATE INDEX IF NOT EXISTS idx_contestant_evictions_grace_period ON public.contestant_evictions(grace_period_ends_at);

-- ============================================================================
-- JUDGE_SAVE_RECORDS: Immutable audit log of judges saving contestants
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.judge_save_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id uuid NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  eviction_id uuid NOT NULL REFERENCES public.contestant_evictions(id) ON DELETE CASCADE,

  -- Who saved
  saved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  save_type text NOT NULL DEFAULT 'judge' CHECK (save_type IN ('judge', 'admin', 'admin_vote')),

  -- Reason
  reason text,

  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  UNIQUE(eviction_id, saved_by)  -- One person can only save each evicted contestant once
);

CREATE INDEX IF NOT EXISTS idx_judge_save_records_contestant ON public.judge_save_records(contestant_id);
CREATE INDEX IF NOT EXISTS idx_judge_save_records_stage ON public.judge_save_records(contest_id, stage_number);
CREATE INDEX IF NOT EXISTS idx_judge_save_records_saved_by ON public.judge_save_records(saved_by);

-- ============================================================================
-- CONTESTANT_EVICTION_VISIBILITY: Template styling for evicted contestants
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.contestant_eviction_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id uuid NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  contest_id uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  stage_number integer NOT NULL,
  eviction_id uuid NOT NULL REFERENCES public.contestant_evictions(id) ON DELETE CASCADE,

  -- Visual styling
  background_template text NOT NULL DEFAULT 'evicted' CHECK (background_template IN ('evicted', 'saved', 'normal')),
  display_message text,

  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  UNIQUE(contestant_id, contest_id, stage_number)
);

CREATE INDEX IF NOT EXISTS idx_contestant_eviction_visibility ON public.contestant_eviction_visibility(contestant_id, contest_id);

-- ============================================================================
-- Update contestants table to track current stage
-- ============================================================================
ALTER TABLE IF EXISTS public.contestants
  ADD COLUMN IF NOT EXISTS current_stage_number integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS eviction_status text DEFAULT 'none' CHECK (eviction_status IN ('none', 'pending', 'saved')),
  ADD COLUMN IF NOT EXISTS eviction_template text DEFAULT 'normal' CHECK (eviction_template IN ('normal', 'evicted', 'saved'));

-- ============================================================================
-- RPC FUNCTION: Mark bottom 20% for eviction
-- ============================================================================
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
  v_eviction_record_id uuid;
  v_total_contestants integer;
  v_to_evict integer;
  v_current_user_id uuid;
  v_grace_period_end timestamptz;
BEGIN
  -- Use provided user or current authenticated user
  v_current_user_id := COALESCE(p_triggered_by, auth.uid());
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to trigger evictions';
  END IF;

  -- Calculate grace period end time
  v_grace_period_end := timezone('utc', now()) + (p_grace_period_hours || ' hours')::interval;

  -- Get total active contestants in this stage
  SELECT COUNT(*) INTO v_total_contestants
  FROM public.contestant_stage_assignments csa
  WHERE csa.contest_id = p_contest_id
    AND csa.stage_number = p_stage_number
    AND csa.status = 'active';

  -- Calculate how many to evict
  v_to_evict := GREATEST(1, CEIL(v_total_contestants * p_eviction_percentage / 100.0)::integer);

  -- Evict bottom 20% by vote count
  RETURN QUERY
  WITH ranked_contestants AS (
    SELECT
      csa.id,
      csa.contestant_id,
      COALESCE(vt.total_confirmed_votes, 0) as vote_count,
      ROW_NUMBER() OVER (ORDER BY COALESCE(vt.total_confirmed_votes, 0) ASC, csa.created_at DESC) as eviction_rank
    FROM public.contestant_stage_assignments csa
    LEFT JOIN public.vote_totals vt
      ON vt.contestant_id = csa.contestant_id
      AND vt.contest_id = p_contest_id
    WHERE csa.contest_id = p_contest_id
      AND csa.stage_number = p_stage_number
      AND csa.status = 'active'
    ORDER BY vote_count ASC, csa.created_at DESC
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
      rc.vote_count,
      rc.eviction_rank,
      timezone('utc', now()),
      v_grace_period_end,
      'pending',
      'Bottom ' || p_eviction_percentage || '% by vote count'
    FROM ranked_contestants rc
    RETURNING id, contestant_id, vote_count, eviction_rank
  )
  SELECT
    ie.contestant_id,
    ie.vote_count,
    ie.eviction_rank,
    ie.id
  FROM inserted_evictions ie;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: Save contestant from eviction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_contestant_from_eviction(
  p_eviction_id uuid,
  p_saved_by uuid DEFAULT NULL,
  p_save_type text DEFAULT 'judge',
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  message text,
  save_record_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eviction_record contestant_evictions;
  v_current_user_id uuid;
  v_save_record_id uuid;
  v_existing_saves integer;
BEGIN
  v_current_user_id := COALESCE(p_saved_by, auth.uid());
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to save contestants';
  END IF;

  -- Get eviction record
  SELECT * INTO v_eviction_record
  FROM public.contestant_evictions
  WHERE id = p_eviction_id
    AND status = 'pending'
  FOR UPDATE;

  IF v_eviction_record IS NULL THEN
    RETURN QUERY SELECT false, 'Eviction not found or already resolved', NULL::uuid;
    RETURN;
  END IF;

  -- If judge, check if already saved one in this stage
  IF p_save_type = 'judge' THEN
    SELECT COUNT(*) INTO v_existing_saves
    FROM public.judge_save_records
    WHERE saved_by = v_current_user_id
      AND contest_id = v_eviction_record.contest_id
      AND stage_number = v_eviction_record.stage_number;

    IF v_existing_saves >= 1 THEN
      RETURN QUERY SELECT false, 'Judge can only save one contestant per stage', NULL::uuid;
      RETURN;
    END IF;
  END IF;

  -- Create save record
  INSERT INTO public.judge_save_records (
    contestant_id,
    contest_id,
    stage_number,
    eviction_id,
    saved_by,
    save_type,
    reason
  )
  VALUES (
    v_eviction_record.contestant_id,
    v_eviction_record.contest_id,
    v_eviction_record.stage_number,
    p_eviction_id,
    v_current_user_id,
    p_save_type,
    p_reason
  )
  ON CONFLICT (eviction_id, saved_by) DO UPDATE SET
    reason = EXCLUDED.reason
  RETURNING id INTO v_save_record_id;

  -- Update eviction status to saved
  UPDATE public.contestant_evictions
  SET status = 'saved',
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE id = p_eviction_id;

  -- Update contestant visibility
  INSERT INTO public.contestant_eviction_visibility (
    contestant_id,
    contest_id,
    stage_number,
    eviction_id,
    background_template,
    display_message
  )
  VALUES (
    v_eviction_record.contestant_id,
    v_eviction_record.contest_id,
    v_eviction_record.stage_number,
    p_eviction_id,
    'saved',
    'Saved by ' || CASE WHEN p_save_type = 'admin' THEN 'Admin' ELSE 'Judge' END
  )
  ON CONFLICT (contestant_id, contest_id, stage_number) DO UPDATE SET
    background_template = 'saved',
    display_message = 'Saved by ' || CASE WHEN p_save_type = 'admin' THEN 'Admin' ELSE 'Judge' END,
    updated_at = timezone('utc', now());

  -- Update contestant status
  UPDATE public.contestants
  SET eviction_status = 'saved',
      eviction_template = 'saved',
      updated_at = timezone('utc', now())
  WHERE id = v_eviction_record.contestant_id;

  RETURN QUERY SELECT true, 'Contestant saved successfully', v_save_record_id;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: Extend grace period for evictions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.extend_eviction_grace_period(
  p_eviction_id uuid,
  p_additional_hours integer DEFAULT 24,
  p_extended_by uuid DEFAULT NULL
)
RETURNS TABLE (
  success boolean,
  message text,
  new_grace_period_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_user_id uuid;
  v_eviction_record contestant_evictions;
  v_new_end_time timestamptz;
BEGIN
  v_current_user_id := COALESCE(p_extended_by, auth.uid());
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to extend grace periods';
  END IF;

  -- Get eviction record
  SELECT * INTO v_eviction_record
  FROM public.contestant_evictions
  WHERE id = p_eviction_id
    AND status = 'pending'
  FOR UPDATE;

  IF v_eviction_record IS NULL THEN
    RETURN QUERY SELECT false, 'Eviction not found or already resolved', NULL::timestamptz;
    RETURN;
  END IF;

  -- Calculate new end time
  v_new_end_time := v_eviction_record.grace_period_ends_at + (p_additional_hours || ' hours')::interval;

  -- Update eviction record
  UPDATE public.contestant_evictions
  SET grace_period_ends_at = v_new_end_time,
      grace_period_extended_at = timezone('utc', now()),
      grace_period_extended_by = v_current_user_id,
      original_grace_period_ends_at = COALESCE(original_grace_period_ends_at, grace_period_ends_at),
      updated_at = timezone('utc', now())
  WHERE id = p_eviction_id;

  RETURN QUERY SELECT true, 'Grace period extended', v_new_end_time;
END;
$$;

-- ============================================================================
-- RPC FUNCTION: Finalize evictions (remove unsaved contestants from stage)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.finalize_stage_evictions(
  p_contest_id uuid,
  p_stage_number integer
)
RETURNS TABLE (
  finalized_count integer,
  saved_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_finalized integer;
  v_saved integer;
BEGIN
  -- Get counts before finalization
  SELECT COUNT(*) INTO v_saved
  FROM public.contestant_evictions
  WHERE contest_id = p_contest_id
    AND stage_number = p_stage_number
    AND status = 'saved';

  SELECT COUNT(*) INTO v_finalized
  FROM public.contestant_evictions
  WHERE contest_id = p_contest_id
    AND stage_number = p_stage_number
    AND status = 'pending'
    AND grace_period_ends_at <= timezone('utc', now());

  -- Update contestant stage assignments for finalized evictions
  UPDATE public.contestant_stage_assignments csa
  SET status = 'evicted',
      evicted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE csa.contestant_id IN (
    SELECT contestant_id
    FROM public.contestant_evictions
    WHERE contest_id = p_contest_id
      AND stage_number = p_stage_number
      AND status = 'pending'
      AND grace_period_ends_at <= timezone('utc', now())
  )
  AND csa.contest_id = p_contest_id
  AND csa.stage_number = p_stage_number;

  -- Update eviction records to finalized
  UPDATE public.contestant_evictions
  SET status = 'finalized',
      resolved_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE contest_id = p_contest_id
    AND stage_number = p_stage_number
    AND status = 'pending'
    AND grace_period_ends_at <= timezone('utc', now());

  -- Update visibility for finalized evictions
  INSERT INTO public.contestant_eviction_visibility (
    contestant_id,
    contest_id,
    stage_number,
    eviction_id,
    background_template,
    display_message
  )
  SELECT
    ce.contestant_id,
    ce.contest_id,
    ce.stage_number,
    ce.id,
    'evicted',
    'Evicted from stage ' || ce.stage_number
  FROM public.contestant_evictions ce
  WHERE ce.contest_id = p_contest_id
    AND ce.stage_number = p_stage_number
    AND ce.status = 'finalized'
  ON CONFLICT (contestant_id, contest_id, stage_number) DO UPDATE SET
    background_template = 'evicted',
    display_message = 'Evicted from stage ' || EXCLUDED.stage_number,
    updated_at = timezone('utc', now());

  RETURN QUERY SELECT v_finalized, v_saved;
END;
$$;

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.evict_bottom_percentage TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.save_contestant_from_eviction TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.extend_eviction_grace_period TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_stage_evictions TO service_role;

-- ============================================================================
-- Update RLS policies
-- ============================================================================
ALTER TABLE public.contest_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_stage_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_evictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.judge_save_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_eviction_visibility ENABLE ROW LEVEL SECURITY;

-- Allow public read on stages and visibility
CREATE POLICY "public_read_contest_stages" ON public.contest_stages FOR SELECT USING (true);
CREATE POLICY "public_read_stage_assignments" ON public.contestant_stage_assignments FOR SELECT USING (true);
CREATE POLICY "public_read_eviction_visibility" ON public.contestant_eviction_visibility FOR SELECT USING (true);

-- Allow authenticated users to read evictions and saves
CREATE POLICY "authenticated_read_evictions" ON public.contestant_evictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_read_saves" ON public.judge_save_records FOR SELECT TO authenticated USING (true);

-- Admin-only write access (enforced via RLS at application layer)
CREATE POLICY "admin_manage_stages" ON public.contest_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_manage_assignments" ON public.contestant_stage_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
