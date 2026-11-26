-- Contest locality: state -> local government -> village.
--
-- THE GAP
-- `contests.location_scope` has existed since the platform enhancements
-- migration and the admin console writes it, but the vocabulary never included
-- "local to a specific local government", and nothing anywhere in the repo
-- stored a village. The geography selects in both registration wizards are
-- labelled "City / town" while their options are the 774 LGAs
-- (frontend-web/src/features/registration/reference-data.ts's
-- NIGERIA_CITIES_BY_STATE), and `contestants` records only `state`. So an
-- Onitsha contest could not say which quarter of Onitsha it belongs to, and
-- nobody could show or filter a roster by that.
--
-- WHAT THIS ADDS
--   1. public.villages — the curated reference table the village picker reads,
--      keyed (state, lga, name).
--   2. locality_state / locality_lga / locality_village on BOTH contest planes
--      and lga / village on contestants.
--   3. locality carried through the contests -> connect_contests mirror, which
--      is the row Go's /api/v1/connect/* serves to the phone.
--   4. the wizard's answers preserved through
--      promote_registration_to_contestant() onto the contestant row.
--
-- ⚠️ THE SEED IS THE SUPPLIED LIST — NOT A GAZETTEER
-- Only Onitsha North has rows, because those 15 quarters are the ones a human
-- named. Every other LGA stays deliberately EMPTY, and the pickers fall back to
-- a typed village there. Inventing "villages" for the other 773 LGAs would put
-- fabricated names on a locality the platform treats as real; an admin would
-- have no way to tell a curated quarter from a guess. An empty list is the
-- honest signal, and it is what makes the fallback necessary.
--
-- ⚠️ sync_connect_contest() IS RE-CREATED FROM ITS CURRENT DEFINITION
-- That is 20271024000000_contest_logo.sql (rules_text + banner_image_url +
-- logo_url), plus the three locality columns. Rebuilding it from anything
-- older drops a column and silently breaks rules, banner or logo on mobile —
-- the failure 20270109000000 documented when an earlier banner attempt had been
-- reverted underneath it.
--
-- ⚠️ promote_registration_to_contestant() IS RE-CREATED FROM ITS CURRENT
-- DEFINITION TOO (the contestants_profile_columns / reference-driven version
-- that reads form_data keys like 'personal.stateOfResidence'). Adding columns
-- to `contestants` does not make the function fill them.
--
-- Additive only: no DROP, no renames, no type narrowing, no CHECK on
-- location_scope — the widened vocabulary is documented and enforced at the
-- write boundary (frontend-admin + /api/admin/contests), because a CHECK would
-- make this file refuse to replay on any environment holding a value outside
-- the list. Idempotent: replayable by `supabase db push` and by the live-DB
-- test that applies this file twice.

-- ---------------------------------------------------------------------------
-- 1. The curated village reference table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.villages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state      TEXT NOT NULL CHECK (char_length(btrim(state)) > 1),
  lga        TEXT NOT NULL CHECK (char_length(btrim(lga)) > 1),
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) > 1),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT villages_state_lga_name_key UNIQUE (state, lga, name)
);

COMMENT ON TABLE public.villages IS
  'Curated village/quarter names under a state + local government. A row exists only where a human supplied the list; an empty LGA means the registration pickers take a typed village instead.';
COMMENT ON COLUMN public.villages.is_active IS
  'FALSE hides a quarter from the picker without deleting the answer already stored on contestants.village.';

CREATE INDEX IF NOT EXISTS villages_state_lga_active_idx
  ON public.villages (state, lga)
  WHERE is_active;

-- Read is public (the pickers and the roster filter are anonymous surfaces);
-- writing stays with an admin account, via the same public.is_admin() helper the
-- academy/audition/media policies use. Service-role callers (the Go API and the
-- BFF admin routes) bypass RLS either way.
ALTER TABLE public.villages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS villages_public_read ON public.villages;
CREATE POLICY villages_public_read ON public.villages
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS villages_admin_manage ON public.villages;
CREATE POLICY villages_admin_manage ON public.villages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Locality columns on both contest planes, and on contestants
-- ---------------------------------------------------------------------------

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS locality_state   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locality_lga     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locality_village TEXT NOT NULL DEFAULT '';

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS locality_state   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locality_lga     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locality_village TEXT NOT NULL DEFAULT '';

ALTER TABLE public.contestants
  ADD COLUMN IF NOT EXISTS lga     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS village TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.contests.location_scope IS
  'Widened vocabulary for 20272000000000: state | regional | national | international | lga | village. lga/village mean the contest is local and the locality_* columns name that locality; enforcement is display + filter only, so nobody is blocked from entering or voting on where they live.';
COMMENT ON COLUMN public.contests.locality_state IS
  'State a local contest belongs to. Empty on state/regional/national/international contests.';
COMMENT ON COLUMN public.contestants.lga IS
  'Local government from the applicant''s state-of-origin cascade (personal.localGovernment), preserved by promotion. Display + filter only.';
COMMENT ON COLUMN public.contestants.village IS
  'Village/quarter from the LGA cascade (personal.village). Either a curated public.villages name or a typed answer for an LGA nobody has curated.';

-- ---------------------------------------------------------------------------
-- 3. Carry locality through the mirror
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug, rules_text, banner_image_url, logo_url,
     locality_state, locality_lga, locality_village)
  VALUES (
    NEW.id,
    left(btrim(NEW.name), 200),
    COALESCE(NEW.description, ''),
    public.connect_contest_status(NEW.status::text),
    -- vote_price_ngn is naira by name; kobo is the storage unit here.
    COALESCE(NEW.vote_price_ngn, 0) * 100,
    GREATEST(COALESCE(NEW.max_votes_per_user, 0), 0),
    COALESCE(NEW.voting_start_date, NEW.start_date),
    COALESCE(NEW.voting_end_date, NEW.end_date),
    NEW.slug,
    COALESCE(NEW.rules_text, ''),
    COALESCE(NEW.banner_image_url, ''),
    COALESCE(NEW.logo_url, ''),
    COALESCE(NEW.locality_state, ''),
    COALESCE(NEW.locality_lga, ''),
    COALESCE(NEW.locality_village, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    title               = EXCLUDED.title,
    description         = EXCLUDED.description,
    status              = EXCLUDED.status,
    paid_vote_kobo      = EXCLUDED.paid_vote_kobo,
    free_votes_per_user = EXCLUDED.free_votes_per_user,
    opens_at            = EXCLUDED.opens_at,
    closes_at           = EXCLUDED.closes_at,
    slug                = EXCLUDED.slug,
    rules_text          = EXCLUDED.rules_text,
    banner_image_url    = EXCLUDED.banner_image_url,
    logo_url            = EXCLUDED.logo_url,
    locality_state      = EXCLUDED.locality_state,
    locality_lga        = EXCLUDED.locality_lga,
    locality_village    = EXCLUDED.locality_village,
    updated_at          = now();

  RETURN NEW;
END;
$$;

-- Backfill: carry any locality already on a contest across to its mirror row.
-- Idempotent, and a no-op on a fresh database where every value is ''.
UPDATE public.connect_contests cc
   SET locality_state   = c.locality_state,
       locality_lga     = c.locality_lga,
       locality_village = c.locality_village,
       updated_at       = now()
  FROM public.contests c
 WHERE c.id = cc.id
   AND (COALESCE(c.locality_state, '') <> ''
        OR COALESCE(c.locality_lga, '') <> ''
        OR COALESCE(c.locality_village, '') <> '')
   AND (COALESCE(cc.locality_state, ''), COALESCE(cc.locality_lga, ''),
        COALESCE(cc.locality_village, ''))
       IS DISTINCT FROM
       (COALESCE(c.locality_state, ''), COALESCE(c.locality_lga, ''),
        COALESCE(c.locality_village, ''));

-- ---------------------------------------------------------------------------
-- 4. Preserve the wizard's answers through promotion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.promote_registration_to_contestant(p_registration_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_reg                public.registrations%ROWTYPE;
  v_connect_contest_id UUID;
  v_contest_id         UUID;
  v_name               TEXT;
  v_stage_name         TEXT;
  v_category           TEXT;
  v_state              TEXT;
  v_lga                TEXT;
  v_village            TEXT;
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

  -- Residence still wins, because that is what audition-city matching has
  -- always keyed off. State of origin is added as the LAST fallback: the
  -- locality cascade hangs off origin, so a contestant who only answered origin
  -- would otherwise show an empty state on a locality-filtered roster.
  v_state := COALESCE(NULLIF(v_reg.form_data->>'personal.stateOfResidence', ''),
                      NULLIF(v_reg.form_data->>'account.state', ''),
                      NULLIF(v_reg.form_data->>'personal.stateOfOrigin', ''), '');

  -- The origin cascade. Deliberately NOT derived from residence: the two
  -- questions are independent, and a local contest is about where the
  -- contestant comes from.
  v_lga     := COALESCE(v_reg.form_data->>'personal.localGovernment', '');
  v_village := COALESCE(v_reg.form_data->>'personal.village', '');

  v_bio   := COALESCE(NULLIF(v_reg.form_data->>'personal.bio', ''),
                      v_reg.form_data->>'talent.careerGoal', '');
  v_photo := COALESCE(v_reg.form_data->>'media.profilePhoto', '');
  v_media := COALESCE(v_reg.form_data->>'category.sampleLink', '');

  INSERT INTO public.contestants (
    registration_id, contest_id, connect_contest_id, user_id,
    name, stage_name, category, state, lga, village, bio, photo_url, media_url,
    status, is_active
  ) VALUES (
    p_registration_id, v_contest_id, v_connect_contest_id, v_reg.user_id,
    v_name, v_stage_name, v_category, v_state, v_lga, v_village, v_bio, v_photo, v_media,
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
    -- A re-promotion with no locality answer must not erase one an admin
    -- already curated or an earlier application supplied.
    lga        = COALESCE(NULLIF(EXCLUDED.lga, ''), public.contestants.lga),
    village    = COALESCE(NULLIF(EXCLUDED.village, ''), public.contestants.village),
    bio        = EXCLUDED.bio,
    photo_url  = EXCLUDED.photo_url,
    media_url  = EXCLUDED.media_url,
    status     = 'approved',
    is_active  = TRUE,
    updated_at = NOW()
  RETURNING id INTO v_contestant;

  RETURN v_contestant;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The seed — the 15 quarters supplied for Onitsha, under Onitsha North
-- ---------------------------------------------------------------------------

INSERT INTO public.villages (state, lga, name) VALUES
  ('Anambra', 'Onitsha North', 'Isiokwe'),
  ('Anambra', 'Onitsha North', 'Mgbelekeke'),
  ('Anambra', 'Onitsha North', 'Obikporo'),
  ('Anambra', 'Onitsha North', 'Ogbeabo'),
  ('Anambra', 'Onitsha North', 'Ogbendida'),
  ('Anambra', 'Onitsha North', 'Ogbeodogwu'),
  ('Anambra', 'Onitsha North', 'Ogbeotu'),
  ('Anambra', 'Onitsha North', 'Ogboli'),
  ('Anambra', 'Onitsha North', 'Omagba'),
  ('Anambra', 'Onitsha North', 'Owelle Ebo'),
  ('Anambra', 'Onitsha North', 'Umuaroli'),
  ('Anambra', 'Onitsha North', 'Umuasele'),
  ('Anambra', 'Onitsha North', 'Umudei'),
  ('Anambra', 'Onitsha North', 'Umuikem'),
  ('Anambra', 'Onitsha North', 'Ogbeozala')
ON CONFLICT (state, lga, name) DO NOTHING;
