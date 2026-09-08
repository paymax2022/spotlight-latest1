-- Close the one-way gap between the two contest planes.
--
-- THE GAP
-- `contests` (legacy) syncs INTO `connect_contests` via sync_connect_contest(),
-- an AFTER INSERT OR UPDATE trigger. Nothing goes the other way. So a contest
-- created through the newer connect path never gets a legacy row: 3 of 12 had
-- none when this was written, while every legacy contest had a connect twin.
--
-- WHY IT MATTERS
-- vote_packages.contest_id is a FOREIGN KEY to `contests`, not to
-- connect_contests. A contest with no legacy row therefore cannot hold a vote
-- package AT ALL — the FK rejects it. Today that is invisible because those
-- contests are covered by free votes, but the moment somebody tries to make one
-- paid it fails with a foreign key error that names neither the cause nor the
-- fix. This creates the missing row so that cannot happen.
--
-- RECURSION
-- The two triggers could bounce: connect insert -> legacy insert -> forward
-- trigger -> connect upsert. It terminates because this mirror is INSERT-ONLY
-- and uses ON CONFLICT DO NOTHING — the return leg finds the row present and
-- writes nothing, so no trigger fires. The forward trigger's return leg is an
-- UPDATE of connect_contests, and this trigger is AFTER INSERT only, so it does
-- not re-fire either.
--
-- ⚠️ MONEY DRIFT, and why the restore below exists
-- The legacy price column is vote_price_ngn: INTEGER NAIRA. connect stores
-- paid_vote_kobo. Round-tripping 10050 kobo gives 101 naira gives 10100 kobo —
-- the forward trigger would silently reprice the contest by 50 kobo on its way
-- back. Whole-naira prices are unaffected, and every price created through the
-- legacy path is whole-naira by construction, but a connect-created price need
-- not be. connect_contests stays authoritative: its money fields are restored
-- after the mirror insert if the round trip altered them.
--
-- SCOPE: this creates a MISSING row. It is not a bidirectional field sync —
-- ongoing propagation remains one-way (legacy -> connect), exactly as before, so
-- editing a connect contest still leaves its legacy twin stale. That is
-- pre-existing and deliberately untouched here.

-- Reverse of connect_contest_status(). 'upcoming' is unreachable: the forward
-- mapping folds it into 'draft', so there is nothing to map back to it.
CREATE OR REPLACE FUNCTION public.legacy_contest_status(p_status TEXT)
RETURNS public.contest_status
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_status
           WHEN 'open'   THEN 'active'::public.contest_status
           WHEN 'closed' THEN 'ended'::public.contest_status
           ELSE 'draft'::public.contest_status
         END
$$;

CREATE OR REPLACE FUNCTION public.mirror_connect_contest_to_legacy(p_contest_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cc      public.connect_contests%ROWTYPE;
  v_slug    TEXT;
  v_created BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_cc FROM public.connect_contests WHERE id = p_contest_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- sync_connect_contest() refuses a name shorter than 2 characters. Mirroring
  -- such a title would create a legacy row the forward sync would then ignore.
  -- Belt and braces: connect_contests_title_check already forbids it, so this is
  -- unreachable from the trigger — it matters only if the function is called
  -- directly, or if that CHECK is ever relaxed.
  IF v_cc.title IS NULL OR char_length(btrim(v_cc.title)) < 2 THEN
    RETURN FALSE;
  END IF;

  -- contests.slug carries a UNIQUE INDEX (idx_contests_slug_unique — an index,
  -- not a table constraint, so it does not show up in pg_constraint). If a
  -- DIFFERENT legacy contest already holds this slug, copying it would raise
  -- 23505 from inside an AFTER trigger and abort the caller's transaction:
  -- creating the connect contest would fail. The mirror row exists to anchor the
  -- vote_packages foreign key, and a null slug does that just as well, so yield
  -- the slug rather than break the write.
  SELECT CASE
           WHEN v_cc.slug IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM public.contests l
                         WHERE l.slug = v_cc.slug AND l.id <> v_cc.id) THEN NULL
           ELSE v_cc.slug
         END
    INTO v_slug;

  INSERT INTO public.contests
    (id, name, slug, description, status, vote_price_ngn, max_votes_per_user,
     voting_start_date, voting_end_date, rules_text, created_at, updated_at)
  VALUES (
    v_cc.id,
    left(btrim(v_cc.title), 200),
    v_slug,
    COALESCE(v_cc.description, ''),
    public.legacy_contest_status(v_cc.status::text),
    -- Naira. See the money-drift note above.
    ROUND(COALESCE(v_cc.paid_vote_kobo, 0) / 100.0)::INTEGER,
    GREATEST(COALESCE(v_cc.free_votes_per_user, 0), 0),
    v_cc.opens_at,
    v_cc.closes_at,
    COALESCE(v_cc.rules_text, ''),
    COALESCE(v_cc.created_at, NOW()),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF v_created THEN
    -- The insert above fired sync_connect_contest(), which wrote derived values
    -- back onto connect_contests. connect is the authority for money: put its
    -- own figures back if the round trip changed them. This UPDATE cannot
    -- recurse — the mirror trigger is AFTER INSERT only.
    UPDATE public.connect_contests
       SET paid_vote_kobo      = v_cc.paid_vote_kobo,
           free_votes_per_user = v_cc.free_votes_per_user
     WHERE id = p_contest_id
       AND (paid_vote_kobo      IS DISTINCT FROM v_cc.paid_vote_kobo
         OR free_votes_per_user IS DISTINCT FROM v_cc.free_votes_per_user);
  END IF;

  RETURN v_created;
END;
$$;

COMMENT ON FUNCTION public.mirror_connect_contest_to_legacy(UUID) IS
  'Creates the missing public.contests row for a connect contest so it can hold '
  'vote packages (vote_packages.contest_id FKs to contests). Insert-only; '
  'restores connect money fields if the legacy round trip altered them.';

CREATE OR REPLACE FUNCTION public.tg_mirror_connect_contest_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.mirror_connect_contest_to_legacy(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_connect_contest_to_legacy ON public.connect_contests;
CREATE TRIGGER trg_mirror_connect_contest_to_legacy
  AFTER INSERT ON public.connect_contests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_mirror_connect_contest_to_legacy();

-- ---------------------------------------------------------------------------
-- Backfill the contests that never got a legacy row
-- ---------------------------------------------------------------------------

SELECT public.mirror_connect_contest_to_legacy(c.id)
  FROM public.connect_contests c
 WHERE NOT EXISTS (SELECT 1 FROM public.contests l WHERE l.id = c.id);
