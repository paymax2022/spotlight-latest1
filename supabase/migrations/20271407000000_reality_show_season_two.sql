-- Season 2 record the /season-2 page reads.
-- ADDITIVE-ONLY: inserts one row into an existing table; no object is altered.
--
-- app/season-2/page.tsx shows the name and audition window of the newest season
-- whose status is not 'completed'. With no row it prints generic copy, so this
-- is the difference between the page naming Season 2 and not.
--
-- Only the fields the Spotlight team has confirmed are written here. Dates,
-- phase and status stay at the table defaults so the admin console remains the
-- single place that sets them, exactly as it did for the dev row this mirrors.

BEGIN;

-- reality_show_seasons has no unique constraint on season_number, so a repeat
-- apply is a NOT EXISTS guard rather than ON CONFLICT.
DO $do$
BEGIN
  IF to_regclass('public.reality_show_seasons') IS NULL THEN
    RAISE EXCEPTION
      'public.reality_show_seasons is missing; apply 20260604100000_reality_show_stages_evictions.sql before this migration';
  END IF;

  INSERT INTO public.reality_show_seasons (
    season_name, season_number, contest_slug, notes
  )
  SELECT
    'Spotlight Season 2', 2, 'reality-tv-show',
    'Season record for the /season-2 page. Audition and bootcamp dates, phase and status are set by the Spotlight team in the admin console.'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.reality_show_seasons WHERE season_number = 2
  );
END
$do$;

COMMIT;
