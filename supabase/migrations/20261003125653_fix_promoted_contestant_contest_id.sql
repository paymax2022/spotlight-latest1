-- E2E-X-025 / F-C3 — promoted contestants are invisible on the voting roster.
--
-- public.contests and public.connect_contests are mirrored twins that share the
-- same primary key (20261223000000_connect_contests_bridge syncs legacy ->
-- connect preserving id; 20270129000000_mirror_connect_contests_to_legacy
-- creates the missing legacy twin on connect insert). contestants therefore
-- carries BOTH foreign keys, and they are the same value.
--
-- The roster the voter-facing app uses — GET /api/v1/contests/:id/contestants
-- and GET /api/vote-page — resolves contests.id by slug and filters
-- contestants.contest_id. promote_registration_to_contestant() only ever set
-- connect_contest_id, so every contestant it promoted was undiscoverable:
-- votes landed on rows no roster or vote page could reach. Local data showed
-- exactly that shape (contest_id NULL, connect_contest_id set).
--
-- The existing trg_default_connect_contest_id trigger (20261223000000)
-- defaults connect_contest_id FROM contest_id but nothing fills the reverse
-- direction, which is the gap the RPC fell through.
--
-- Fix, additive-only:
--   1. CREATE OR REPLACE the RPC so it populates contest_id too.
--   2. A symmetric BEFORE trigger filling contest_id from connect_contest_id,
--      so every writer — not only this RPC — lands on both keys. Guarded by an
--      EXISTS probe so a connect id with no contests twin can never trip the
--      contestants.contest_id foreign key.
--   3. Backfill the rows already stranded.
--
-- No column removals / renames / type narrowing. New trigger + CREATE OR
-- REPLACE FUNCTION + UPDATE backfill.

-- ---------------------------------------------------------------------------
-- 1. The promotion seam writes both contest keys
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.promote_registration_to_contestant(
  p_registration_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_reg                public.registrations%ROWTYPE;
  v_connect_contest_id UUID;
  v_contest_id         UUID;
  v_name               TEXT;
  v_stage_name         TEXT;
  v_category           TEXT;
  v_state              TEXT;
  v_bio                TEXT;
  v_photo              TEXT;
  v_media              TEXT;
  v_contestant         UUID;
BEGIN
  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT id INTO v_connect_contest_id
  FROM public.connect_contests
  WHERE slug = v_reg.contest_slug;

  -- The roster filters contestants.contest_id against public.contests. The
  -- twin row shares the connect id, so prefer it; fall back to a direct slug
  -- match for the edge case where only the legacy twin exists. When the
  -- legacy twin is missing entirely, contest_id stays NULL rather than
  -- violating the FK — same as before this fix, never a promotion failure.
  SELECT COALESCE(
    (SELECT c.id FROM public.contests c WHERE c.id = v_connect_contest_id),
    (SELECT c.id FROM public.contests c WHERE c.slug = v_reg.contest_slug)
  ) INTO v_contest_id;

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
    registration_id, contest_id, connect_contest_id, user_id,
    name, stage_name, category, state, bio, photo_url, media_url,
    status, is_active
  ) VALUES (
    p_registration_id, v_contest_id, v_connect_contest_id, v_reg.user_id,
    v_name, v_stage_name, v_category, v_state, v_bio, v_photo, v_media,
    'approved', TRUE
  )
  ON CONFLICT (registration_id) WHERE registration_id IS NOT NULL
  DO UPDATE SET
    contest_id         = COALESCE(EXCLUDED.contest_id, public.contestants.contest_id),
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
  'Promotes an approved registration into the voting roster. Idempotent on registration_id. '
  'Populates BOTH contestants.contest_id (roster/vote-page key into public.contests) and '
  'contestants.connect_contest_id (connect-plane key); the two contest tables are mirrored '
  'twins sharing the same id.';

-- ---------------------------------------------------------------------------
-- 2. Symmetric default trigger — reverse of trg_default_connect_contest_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_contest_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contest_id IS NULL
     AND NEW.connect_contest_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.contests c
                  WHERE c.id = NEW.connect_contest_id) THEN
    NEW.contest_id := NEW.connect_contest_id;
  END IF;
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE TRIGGER (PostgreSQL ≥14) — no drop needed on a rerun.
CREATE OR REPLACE TRIGGER trg_default_contest_id
  BEFORE INSERT OR UPDATE ON public.contestants
  FOR EACH ROW EXECUTE FUNCTION public.default_contest_id();

-- ---------------------------------------------------------------------------
-- 3. Backfill the stranded rows (guarded by the contests FK target)
-- ---------------------------------------------------------------------------
UPDATE public.contestants
   SET contest_id = connect_contest_id
 WHERE contest_id IS NULL
   AND connect_contest_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.contests c
                WHERE c.id = public.contestants.connect_contest_id);
