-- Bridge the voting contest data planes.
--
-- The mobile voting screen reads GET /api/v1/connect/contests, which Go serves
-- from public.connect_contests. That table had ZERO rows and NO writer anywhere
-- in the repo — only its CREATE TABLE in 20260704000000_connect_money.sql. The
-- real contests live in public.contests (served to web by /api/v1/contests), and
-- contestants.connect_contest_id — the column Go's roster query filters on — was
-- NULL for every row, while contestants.contest_id was populated.
--
-- Net effect: the mobile voting list could only ever be empty, and so could every
-- roster behind it. This mirrors contests -> connect_contests (preserving the id,
-- so contestants.contest_id and .connect_contest_id are the same value) and keeps
-- the two in step from here on.
--
-- Additive only: no DROP TABLE/COLUMN, no renames, no type narrowing.

-- ── Status vocabularies differ ───────────────────────────────────────────────
-- contests.status         : draft | active | upcoming | ended   (enum)
-- connect_contests.status : draft | open   | closed             (CHECK)
-- Go lists only ('open','closed'), and the mobile mapper renders open -> LIVE.
-- 'upcoming' has no faithful target: mapping it to 'open' would label a contest
-- that has not started as LIVE, so it maps to 'draft' and stays hidden on mobile
-- until it flips to active. Widening the CHECK to carry 'upcoming' would need a
-- DROP CONSTRAINT, which the additive-only guard forbids.
CREATE OR REPLACE FUNCTION public.connect_contest_status(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
           WHEN 'active' THEN 'open'
           WHEN 'ended'  THEN 'closed'
           ELSE 'draft'          -- draft, upcoming
         END
$$;

-- Mirror one contests row into connect_contests. Returns without writing when the
-- title cannot satisfy connect_contests' 2..200 char CHECK — a contest must never
-- fail to save because its mirror is unrepresentable.
CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug)
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
    NEW.slug
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
    updated_at          = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_connect_contest ON public.contests;
CREATE TRIGGER trg_sync_connect_contest
  AFTER INSERT OR UPDATE ON public.contests
  FOR EACH ROW EXECUTE FUNCTION public.sync_connect_contest();

-- ── Contestants carry both keys ──────────────────────────────────────────────
-- Go's roster filters on connect_contest_id; the app populates contest_id. Since
-- the mirror preserves the id, defaulting one from the other is exact, not a guess.
CREATE OR REPLACE FUNCTION public.default_connect_contest_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.connect_contest_id IS NULL THEN
    NEW.connect_contest_id := NEW.contest_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_connect_contest_id ON public.contestants;
CREATE TRIGGER trg_default_connect_contest_id
  BEFORE INSERT OR UPDATE ON public.contestants
  FOR EACH ROW EXECUTE FUNCTION public.default_connect_contest_id();

-- ── Backfill (idempotent) ────────────────────────────────────────────────────
INSERT INTO public.connect_contests AS cc
  (id, title, description, status, paid_vote_kobo, free_votes_per_user,
   opens_at, closes_at, slug)
SELECT c.id,
       left(btrim(c.name), 200),
       COALESCE(c.description, ''),
       public.connect_contest_status(c.status::text),
       COALESCE(c.vote_price_ngn, 0) * 100,
       GREATEST(COALESCE(c.max_votes_per_user, 0), 0),
       COALESCE(c.voting_start_date, c.start_date),
       COALESCE(c.voting_end_date, c.end_date),
       c.slug
FROM public.contests c
WHERE c.name IS NOT NULL AND char_length(btrim(c.name)) >= 2
ON CONFLICT (id) DO UPDATE SET
  title               = EXCLUDED.title,
  description         = EXCLUDED.description,
  status              = EXCLUDED.status,
  paid_vote_kobo      = EXCLUDED.paid_vote_kobo,
  free_votes_per_user = EXCLUDED.free_votes_per_user,
  opens_at            = EXCLUDED.opens_at,
  closes_at           = EXCLUDED.closes_at,
  slug                = EXCLUDED.slug,
  updated_at          = now();

UPDATE public.contestants
   SET connect_contest_id = contest_id
 WHERE connect_contest_id IS NULL
   AND contest_id IS NOT NULL;
