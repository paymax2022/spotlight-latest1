-- Contest rules & policies text.
--
-- public.contests.rules_text has existed since 20260405300000_platform_enhancements.sql
-- but nothing ever wrote to it (no admin UI field) and nothing ever read it (no Go
-- model field, no mobile mapper field) — the mobile "Voting Rules & Policies" card
-- (mobile-app/reactnative/src/features/voting/components/VotingRulesCard.tsx) has
-- always shown the same four hardcoded sections for every contest instead. This
-- adds the mirror column so an admin-authored rules_text actually reaches mobile:
-- add it to connect_contests (the table Go's /api/v1/connect/contests actually
-- serves), and carry it through the contests -> connect_contests mirror.
--
-- Additive only: no DROP, no renames, no type narrowing.
--
-- NOT layered on 20270108000000_contest_banner_image.sql's banner_image_url
-- column/trigger version — that migration (and the column it added) was
-- reverted (see the "Revert ..." commits) before this one reached staging or
-- production, so building on it here would leave a dangling column reference
-- the moment a fresh migration replay runs this file without that one having
-- ever applied. This re-creates the trigger from the ORIGINAL pre-banner
-- version (20261223000000_connect_contests_bridge.sql) plus rules_text only.

ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS rules_text TEXT NOT NULL DEFAULT '';

-- Re-create the mirror trigger function (same function name/trigger as
-- 20261223000000_connect_contests_bridge.sql) with rules_text added to both
-- the insert and the ON CONFLICT update column lists.
CREATE OR REPLACE FUNCTION public.sync_connect_contest()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS NULL OR char_length(btrim(NEW.name)) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.connect_contests AS cc
    (id, title, description, status, paid_vote_kobo, free_votes_per_user,
     opens_at, closes_at, slug, rules_text)
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
    COALESCE(NEW.rules_text, '')
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
    updated_at          = now();

  RETURN NEW;
END;
$$;

-- Backfill (idempotent) — carries any existing contests.rules_text values into
-- the mirror (empty string for rows that never had one set, same as default).
INSERT INTO public.connect_contests AS cc
  (id, title, description, status, paid_vote_kobo, free_votes_per_user,
   opens_at, closes_at, slug, rules_text)
SELECT c.id,
       left(btrim(c.name), 200),
       COALESCE(c.description, ''),
       public.connect_contest_status(c.status::text),
       COALESCE(c.vote_price_ngn, 0) * 100,
       GREATEST(COALESCE(c.max_votes_per_user, 0), 0),
       COALESCE(c.voting_start_date, c.start_date),
       COALESCE(c.voting_end_date, c.end_date),
       c.slug,
       COALESCE(c.rules_text, '')
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
  rules_text          = EXCLUDED.rules_text,
  updated_at          = now();
