-- Contest logo.
--
-- A contest already carries an admin-uploaded banner (20270145000000). This adds
-- the sibling logo, set the same way in the admin contest form and carried
-- through the contests -> connect_contests mirror, which is the table Go's
-- /api/v1/connect/contests serves to the mobile app.
--
-- ⚠️ This re-creates public.sync_connect_contest() from its CURRENT definition,
-- 20270145000000_contest_banner_image.sql (rules_text + banner_image_url), and
-- adds logo_url ALONGSIDE them. Do not rebuild it from any older version: an
-- earlier banner attempt (20270108000000) was reverted after a later migration
-- had layered rules_text on top, and a fresh replay then failed with
--   column banner_image_url of relation connect_contests does not exist (42703)
-- which broke CI and blocked a staging deploy. Dropping rules_text or
-- banner_image_url here would silently break the rules and banner on mobile.
--
-- Additive only: no DROP of data, no renames, no type narrowing.

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS logo_url TEXT NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug, rules_text, banner_image_url, logo_url)
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
    COALESCE(NEW.logo_url, '')
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
    updated_at          = now();

  RETURN NEW;
END;
$$;

-- Backfill: carry any logo already on a contest across to its mirror row.
-- Idempotent, and a no-op on a fresh database where every value is ''.
UPDATE public.connect_contests cc
   SET logo_url   = c.logo_url,
       updated_at = now()
  FROM public.contests c
 WHERE c.id = cc.id
   AND COALESCE(c.logo_url, '') <> ''
   AND COALESCE(cc.logo_url, '') IS DISTINCT FROM c.logo_url;
