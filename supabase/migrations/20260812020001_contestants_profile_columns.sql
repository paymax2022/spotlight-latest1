-- Carry the rest of the contestant profile onto the voting roster.
--
-- The registration wizard collects a stage name, a state of residence and media
-- (profile photo + performance sample), but `contestants` had nowhere to put
-- them, so the voter-facing cards rendered blank. Additive only.
--
-- This also corrects the form_data keys the promotion function reads. The
-- original version guessed at 'talent.category', 'performance.category',
-- 'media.photoUrl' and 'media.headshotUrl' — none of which the wizard ever
-- emits (see registration field definitions: the real keys are
-- category.performanceType, talent.primarySkill and media.profilePhoto), so
-- category and photo were silently empty on every promoted contestant.

ALTER TABLE public.contestants
  ADD COLUMN IF NOT EXISTS stage_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_url  TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.contestants.stage_name IS
  'Performing name, shown in preference to the legal name on voter-facing cards.';
COMMENT ON COLUMN public.contestants.state IS
  'State of residence, used for regional filtering on the contestant list.';
COMMENT ON COLUMN public.contestants.media_url IS
  'Performance sample link (YouTube / Instagram / TikTok) from the entry.';

CREATE OR REPLACE FUNCTION public.promote_registration_to_contestant(
  p_registration_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_reg         public.registrations%ROWTYPE;
  v_contest_id  UUID;
  v_name        TEXT;
  v_stage_name  TEXT;
  v_category    TEXT;
  v_state       TEXT;
  v_bio         TEXT;
  v_photo       TEXT;
  v_media       TEXT;
  v_contestant  UUID;
BEGIN
  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_contest_id
  FROM public.connect_contests
  WHERE slug = v_reg.contest_slug;

  v_name := TRIM(COALESCE(v_reg.form_data->>'personal.firstName', '') || ' ' ||
                 COALESCE(v_reg.form_data->>'personal.lastName', ''));
  v_stage_name := COALESCE(v_reg.form_data->>'personal.stageName', '');

  -- Fall back to the stage name, then the reference, so a contestant is never
  -- nameless on the voting card.
  IF v_name = '' THEN
    v_name := COALESCE(NULLIF(v_stage_name, ''), v_reg.reference);
  END IF;

  -- talent.primarySkill is a multi-select (JSON array); take its first entry.
  v_category := COALESCE(
    NULLIF(v_reg.form_data->>'category.performanceType', ''),
    CASE
      WHEN jsonb_typeof(v_reg.form_data->'talent.primarySkill') = 'array'
        THEN v_reg.form_data->'talent.primarySkill'->>0
      ELSE v_reg.form_data->>'talent.primarySkill'
    END,
    '');

  v_state := COALESCE(NULLIF(v_reg.form_data->>'personal.stateOfResidence', ''),
                      v_reg.form_data->>'account.state', '');
  v_bio   := COALESCE(NULLIF(v_reg.form_data->>'personal.bio', ''),
                      v_reg.form_data->>'talent.careerGoal', '');
  v_photo := COALESCE(v_reg.form_data->>'media.profilePhoto', '');
  v_media := COALESCE(v_reg.form_data->>'category.sampleLink', '');

  INSERT INTO public.contestants (
    registration_id, connect_contest_id, user_id,
    name, stage_name, category, state, bio, photo_url, media_url,
    status, is_active
  ) VALUES (
    p_registration_id, v_contest_id, v_reg.user_id,
    v_name, v_stage_name, v_category, v_state, v_bio, v_photo, v_media,
    'approved', TRUE
  )
  ON CONFLICT (registration_id) WHERE registration_id IS NOT NULL
  DO UPDATE SET
    connect_contest_id = COALESCE(EXCLUDED.connect_contest_id, public.contestants.connect_contest_id),
    name       = EXCLUDED.name,
    stage_name = EXCLUDED.stage_name,
    category   = EXCLUDED.category,
    state      = EXCLUDED.state,
    bio        = EXCLUDED.bio,
    photo_url  = EXCLUDED.photo_url,
    media_url  = EXCLUDED.media_url,
    status     = 'approved',
    is_active  = TRUE,
    updated_at = NOW()
  RETURNING id INTO v_contestant;

  RETURN v_contestant;
END;
$$;

COMMENT ON FUNCTION public.promote_registration_to_contestant(UUID) IS
  'Promotes an approved registration into the voting roster. Idempotent on registration_id.';
