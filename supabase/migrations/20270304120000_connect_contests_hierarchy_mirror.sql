-- Contest Promotion Phase 1 (3/6) — mirror the hierarchy/partner/geography
-- columns onto connect_contests and extend the EXISTING bridge triggers to
-- carry them, matching the bridge's established style exactly:
--
--   * sync_connect_contest()            (20261223000000) — legacy -> connect,
--     fires on every INSERT/UPDATE of public.contests, full field sync.
--   * mirror_connect_contest_to_legacy() (20270129000000) — connect -> legacy,
--     INSERT-ONLY, only creates a MISSING legacy row; it does not do ongoing
--     field sync back (documented deliberately in that file's header — ongoing
--     propagation stays one-way, legacy -> connect). This migration mirrors
--     that same asymmetry for the 5 new columns rather than inventing a new
--     bidirectional-sync design.
--
-- connect_contests.parent_contest_id references connect_contests(id), not
-- contests(id): ids are shared 1:1 across the two tables (both bridge
-- migrations preserve `id`), so the same UUID is a valid parent reference in
-- either plane, and connect_contests should only ever point at another row
-- that exists in ITS OWN table.
--
-- Additive only: no DROP, no renames, no type narrowing. CREATE OR REPLACE on
-- the two trigger functions only — no protected legacy file is touched, and
-- neither function's existing behaviour for prior columns changes.

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS parent_contest_id       UUID REFERENCES public.connect_contests(id),
  ADD COLUMN IF NOT EXISTS partner_id              UUID REFERENCES public.contest_partners(id),
  ADD COLUMN IF NOT EXISTS state                   TEXT,
  ADD COLUMN IF NOT EXISTS lga                     TEXT,
  ADD COLUMN IF NOT EXISTS default_promote_top_n   INTEGER;

CREATE INDEX IF NOT EXISTS idx_connect_contests_parent_contest_id
  ON public.connect_contests (parent_contest_id) WHERE parent_contest_id IS NOT NULL;

ALTER TABLE public.connect_contests
  DROP CONSTRAINT IF EXISTS connect_contests_no_self_parent;
ALTER TABLE public.connect_contests
  ADD CONSTRAINT connect_contests_no_self_parent CHECK (parent_contest_id IS NULL OR parent_contest_id <> id);

ALTER TABLE public.connect_contests
  DROP CONSTRAINT IF EXISTS connect_contests_promote_top_n_nonnegative;
ALTER TABLE public.connect_contests
  ADD CONSTRAINT connect_contests_promote_top_n_nonnegative
  CHECK (default_promote_top_n IS NULL OR default_promote_top_n > 0);

-- Same cycle-prevention pattern as contests_reject_parent_cycle(), walking the
-- connect_contests parent chain.
CREATE OR REPLACE FUNCTION public.connect_contests_reject_parent_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_current UUID;
  v_depth   INT := 0;
BEGIN
  IF NEW.parent_contest_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_current := NEW.parent_contest_id;
  WHILE v_current IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'connect_contest_parent_chain_too_deep' USING ERRCODE = '22023';
    END IF;
    IF v_current = NEW.id THEN
      RAISE EXCEPTION 'connect_contest_parent_cycle_detected' USING ERRCODE = '23514';
    END IF;
    SELECT parent_contest_id INTO v_current FROM public.connect_contests WHERE id = v_current;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_connect_contests_reject_parent_cycle ON public.connect_contests;
CREATE TRIGGER trg_connect_contests_reject_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_contest_id ON public.connect_contests
  FOR EACH ROW EXECUTE FUNCTION public.connect_contests_reject_parent_cycle();

-- ---------------------------------------------------------------------------
-- Forward sync (legacy -> connect): extend sync_connect_contest() to carry
-- the 5 new columns. parent_contest_id is copied as-is (same id space), since
-- the reverse mirror below guarantees that once a contest with a parent is
-- mirrored, its parent's connect_contests row exists too (parents must be
-- promoted-into contests, which are themselves mirrored on every write).
-- Everything else about the function (title-length guard, other columns) is
-- unchanged — this is additive to the existing INSERT/ON CONFLICT column list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug,
     parent_contest_id, partner_id, state, lga, default_promote_top_n)
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
    NEW.parent_contest_id,
    NEW.partner_id,
    NEW.state,
    NEW.lga,
    NEW.default_promote_top_n
  )
  ON CONFLICT (id) DO UPDATE SET
    title                  = EXCLUDED.title,
    description            = EXCLUDED.description,
    status                 = EXCLUDED.status,
    paid_vote_kobo         = EXCLUDED.paid_vote_kobo,
    free_votes_per_user    = EXCLUDED.free_votes_per_user,
    opens_at               = EXCLUDED.opens_at,
    closes_at              = EXCLUDED.closes_at,
    slug                   = EXCLUDED.slug,
    parent_contest_id      = EXCLUDED.parent_contest_id,
    partner_id             = EXCLUDED.partner_id,
    state                  = EXCLUDED.state,
    lga                    = EXCLUDED.lga,
    default_promote_top_n  = EXCLUDED.default_promote_top_n,
    updated_at             = now();

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reverse mirror (connect -> legacy): extend mirror_connect_contest_to_legacy()
-- to carry the 5 new columns into the legacy row it creates. This function is
-- INSERT-ONLY / missing-row-only by design (see 20270129000000's header) —
-- carrying these columns here means a connect-originated contest's hierarchy
-- survives into its legacy twin's initial row, without adding an ongoing
-- reverse UPDATE sync that the rest of the bridge deliberately does not have.
-- partner_id/state/lga/default_promote_top_n round-trip exactly (no unit
-- conversion, unlike the money-drift case for paid_vote_kobo/vote_price_ngn).
-- parent_contest_id is copied as-is; if the legacy insert races the parent's
-- own legacy row not existing yet, the FK simply rejects the copy in the same
-- way it already does for any dangling parent_contest_id and the caller sees
-- that error — no special handling added here.
-- ---------------------------------------------------------------------------
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

  IF v_cc.title IS NULL OR char_length(btrim(v_cc.title)) < 2 THEN
    RETURN FALSE;
  END IF;

  SELECT CASE
           WHEN v_cc.slug IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM public.contests l
                         WHERE l.slug = v_cc.slug AND l.id <> v_cc.id) THEN NULL
           ELSE v_cc.slug
         END
    INTO v_slug;

  INSERT INTO public.contests
    (id, name, slug, description, status, vote_price_ngn, max_votes_per_user,
     voting_start_date, voting_end_date, rules_text, created_at, updated_at,
     parent_contest_id, partner_id, state, lga, default_promote_top_n)
  VALUES (
    v_cc.id,
    left(btrim(v_cc.title), 200),
    v_slug,
    COALESCE(v_cc.description, ''),
    public.legacy_contest_status(v_cc.status::text),
    ROUND(COALESCE(v_cc.paid_vote_kobo, 0) / 100.0)::INTEGER,
    GREATEST(COALESCE(v_cc.free_votes_per_user, 0), 0),
    v_cc.opens_at,
    v_cc.closes_at,
    COALESCE(v_cc.rules_text, ''),
    COALESCE(v_cc.created_at, NOW()),
    NOW(),
    v_cc.parent_contest_id,
    v_cc.partner_id,
    v_cc.state,
    v_cc.lga,
    v_cc.default_promote_top_n
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF v_created THEN
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

-- ---------------------------------------------------------------------------
-- Backfill (idempotent) — carry existing hierarchy/partner/geography values
-- (all NULL for every pre-existing row, since the columns are new, so this is
-- a no-op today; kept for parity with the original bridge's backfill block
-- and to cover any row inserted between the two ALTERs in this same migration
-- via a concurrent writer).
-- ---------------------------------------------------------------------------
UPDATE public.connect_contests cc
   SET parent_contest_id     = c.parent_contest_id,
       partner_id            = c.partner_id,
       state                 = c.state,
       lga                   = c.lga,
       default_promote_top_n = c.default_promote_top_n
  FROM public.contests c
 WHERE cc.id = c.id
   AND (cc.parent_contest_id     IS DISTINCT FROM c.parent_contest_id
     OR cc.partner_id            IS DISTINCT FROM c.partner_id
     OR cc.state                 IS DISTINCT FROM c.state
     OR cc.lga                   IS DISTINCT FROM c.lga
     OR cc.default_promote_top_n IS DISTINCT FROM c.default_promote_top_n);
