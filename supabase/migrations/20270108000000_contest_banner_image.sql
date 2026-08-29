-- Contest banner image.
--
-- Mobile's ContestCard/ContestHero already render contest.bannerImage when
-- present (mobile-app/reactnative/src/features/voting/components/ContestCard.tsx,
-- ContestHero.tsx) but nothing ever set it: public.contests had no image column
-- at all, so every real contest fell back to the placeholder tile. This adds the
-- column, carries it through the contests -> connect_contests mirror (the table
-- Go's /api/v1/connect/contests actually serves), and backfills existing rows.
--
-- Additive only: no DROP, no renames, no type narrowing.

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT NOT NULL DEFAULT '';

-- Re-create the mirror trigger function (same function name/trigger as
-- 20261223000000_connect_contests_bridge.sql) with banner_image_url added to
-- both the insert and the ON CONFLICT update column lists.
CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug, banner_image_url)
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
    COALESCE(NEW.banner_image_url, '')
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
    banner_image_url    = EXCLUDED.banner_image_url,
    updated_at          = now();

  RETURN NEW;
END;
$$;

-- Backfill (idempotent) — carries existing banner_image_url values (empty
-- string for every pre-existing row, same as a fresh default) into the mirror.
INSERT INTO public.connect_contests AS cc
  (id, title, description, status, paid_vote_kobo, free_votes_per_user,
   opens_at, closes_at, slug, banner_image_url)
SELECT c.id,
       left(btrim(c.name), 200),
       COALESCE(c.description, ''),
       public.connect_contest_status(c.status::text),
       COALESCE(c.vote_price_ngn, 0) * 100,
       GREATEST(COALESCE(c.max_votes_per_user, 0), 0),
       COALESCE(c.voting_start_date, c.start_date),
       COALESCE(c.voting_end_date, c.end_date),
       c.slug,
       COALESCE(c.banner_image_url, '')
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
  banner_image_url    = EXCLUDED.banner_image_url,
  updated_at          = now();
