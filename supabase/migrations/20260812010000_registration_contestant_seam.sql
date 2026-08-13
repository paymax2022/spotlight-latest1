-- Registration -> contestant seam.
--
-- Until now an approved registration never became something anyone could vote
-- for: `registrations` (the entry funnel) and `contestants` (the voting roster)
-- had no link. This adds that link, additively — no drops, no renames, no type
-- narrowing.
--
-- The promotion is keyed on registration_id with a UNIQUE constraint, which is
-- what makes it idempotent: approving twice (double click, retried request,
-- replayed webhook) can only ever produce one contestant row.

-- ---------------------------------------------------------------------------
-- 1. Slug on connect_contests so a registration's contest_slug resolves to the
--    contest its contestants are voted in.
-- ---------------------------------------------------------------------------
ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS connect_contests_slug_key
  ON public.connect_contests (slug)
  WHERE slug IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Link columns on contestants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contestants
  ADD COLUMN IF NOT EXISTS registration_id UUID
    REFERENCES public.registrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connect_contest_id UUID
    REFERENCES public.connect_contests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- One contestant per registration. Partial so the many pre-existing contestants
-- with a NULL registration_id are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS contestants_registration_id_key
  ON public.contestants (registration_id)
  WHERE registration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contestants_connect_contest_id_idx
  ON public.contestants (connect_contest_id)
  WHERE connect_contest_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contestants_user_id_idx
  ON public.contestants (user_id)
  WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Promotion function.
--
-- Called when an admin moves a registration into a roster-bearing status.
-- Returns the contestant id (existing or new). Idempotent by the unique index
-- above: a second call updates the existing row rather than inserting.
--
-- SECURITY INVOKER (the default) on purpose — the caller is the Go admin
-- handler running behind an RBAC guard with the service role; running this as
-- DEFINER would let any role that can EXECUTE it mint contestants.
-- ---------------------------------------------------------------------------
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
  v_category    TEXT;
  v_bio         TEXT;
  v_photo       TEXT;
  v_contestant  UUID;
BEGIN
  SELECT * INTO v_reg FROM public.registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Resolve the contest by slug. A registration for a contest that has no
  -- connect_contests row yet promotes with a NULL contest rather than failing,
  -- so the roster entry is never lost; wiring the contest later backfills it.
  SELECT id INTO v_contest_id
  FROM public.connect_contests
  WHERE slug = v_reg.contest_slug;

  -- form_data is the wizard's flat key->value map (see the registration wizard).
  v_name := TRIM(COALESCE(v_reg.form_data->>'personal.firstName', '') || ' ' ||
                 COALESCE(v_reg.form_data->>'personal.lastName', ''));
  IF v_name = '' THEN
    v_name := COALESCE(v_reg.form_data->>'personal.stageName', v_reg.reference);
  END IF;

  v_category := COALESCE(v_reg.form_data->>'talent.category',
                         v_reg.form_data->>'performance.category', '');
  v_bio      := COALESCE(v_reg.form_data->>'personal.bio', '');
  v_photo    := COALESCE(v_reg.form_data->>'media.photoUrl',
                         v_reg.form_data->>'media.headshotUrl', '');

  INSERT INTO public.contestants (
    registration_id, connect_contest_id, user_id,
    name, category, bio, photo_url, status, is_active
  ) VALUES (
    p_registration_id, v_contest_id, v_reg.user_id,
    v_name, v_category, v_bio, v_photo, 'approved', TRUE
  )
  ON CONFLICT (registration_id) WHERE registration_id IS NOT NULL
  DO UPDATE SET
    connect_contest_id = COALESCE(EXCLUDED.connect_contest_id, public.contestants.connect_contest_id),
    name       = EXCLUDED.name,
    category   = EXCLUDED.category,
    bio        = EXCLUDED.bio,
    photo_url  = EXCLUDED.photo_url,
    status     = 'approved',
    is_active  = TRUE,
    updated_at = NOW()
  RETURNING id INTO v_contestant;

  RETURN v_contestant;
END;
$$;

COMMENT ON FUNCTION public.promote_registration_to_contestant(UUID) IS
  'Promotes an approved registration into the voting roster. Idempotent on registration_id.';

-- ---------------------------------------------------------------------------
-- 4. Realtime. The admin console and the mobile voting screens subscribe to
--    these tables so an approval or a cast vote reaches the other surface
--    without a refresh.
--
--    Guarded: adding a table already in the publication raises 42710.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.registrations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.contestants;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- Realtime delivers only the primary key on UPDATE/DELETE unless the table
-- replicates full rows; the admin list needs the changed columns themselves.
ALTER TABLE public.registrations REPLICA IDENTITY FULL;
ALTER TABLE public.contestants   REPLICA IDENTITY FULL;
