-- Contest banner image.
--
-- Mobile ALREADY renders a banner: ContestCard.tsx and ContestHero.tsx both draw
-- `contest.bannerImage` when present, and fall back to a placeholder tile when it
-- is not. Until now only the mock fixtures ever set it — public.contests had no
-- image column, so every real contest showed the placeholder. This adds the
-- column and carries it through the contests -> connect_contests mirror, which is
-- the table Go's /api/v1/connect/contests actually serves.
--
-- ⚠️ HISTORY. A previous attempt at this feature (20270108000000) was reverted,
-- and its fallout is the reason this migration is written the way it is. That one
-- rebuilt sync_connect_contest() from the version current at the time; when it
-- was reverted, 20270109000000_contest_rules_text.sql had already layered ITS
-- rewrite on top, so a fresh replay hit
--   column banner_image_url of relation connect_contests does not exist (42703)
-- which failed CI and blocked a staging deploy.
--
-- So this migration re-creates the function from the CURRENT definition
-- (20270109000000, which carries rules_text) and adds banner_image_url ALONGSIDE
-- it. Dropping rules_text here would silently break the admin-configurable rules
-- shown on mobile — the same class of bug in the other direction.
--
-- Additive only: no DROP, no renames, no type narrowing.

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT NOT NULL DEFAULT '';

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS banner_image_url TEXT NOT NULL DEFAULT '';

-- Mirror trigger: same function and trigger name as
-- 20261223000000_connect_contests_bridge.sql, most recently redefined by
-- 20270109000000_contest_rules_text.sql. Carries rules_text AND banner_image_url.
CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug, rules_text, banner_image_url)
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
    rules_text          = EXCLUDED.rules_text,
    banner_image_url    = EXCLUDED.banner_image_url,
    updated_at          = now();

  RETURN NEW;
END;
$$;

-- Backfill: carry any banner already on a contest across to its mirror row.
-- Idempotent, and a no-op on a fresh database where every value is ''.
UPDATE public.connect_contests cc
   SET banner_image_url = c.banner_image_url,
       updated_at       = now()
  FROM public.contests c
 WHERE c.id = cc.id
   AND COALESCE(c.banner_image_url, '') <> ''
   AND COALESCE(cc.banner_image_url, '') IS DISTINCT FROM c.banner_image_url;
