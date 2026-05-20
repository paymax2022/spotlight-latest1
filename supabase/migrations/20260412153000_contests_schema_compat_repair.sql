-- ============================================================
-- Contests Schema Compatibility Repair
-- Ensures core multi-skill/Open Mic columns exist and are backfilled.
-- Safe to run repeatedly.
-- ============================================================

BEGIN;

ALTER TABLE public.contests
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS contest_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_scope TEXT NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS age_min INTEGER,
  ADD COLUMN IF NOT EXISTS age_max INTEGER,
  ADD COLUMN IF NOT EXISTS genre_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS max_entries_per_user INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS shortlisting_limit INTEGER,
  ADD COLUMN IF NOT EXISTS judge_weight NUMERIC(5, 2) NOT NULL DEFAULT 40.00,
  ADD COLUMN IF NOT EXISTS public_vote_weight NUMERIC(5, 2) NOT NULL DEFAULT 60.00,
  ADD COLUMN IF NOT EXISTS entry_fee_ngn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vote_price_ngn INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rules_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS eligibility_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sponsor_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS prize_structure JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill rule text from legacy rules where possible.
UPDATE public.contests
SET rules_text = COALESCE(NULLIF(btrim(rules_text), ''), NULLIF(btrim(rules), ''), '')
WHERE COALESCE(NULLIF(btrim(rules_text), ''), '') = '';

-- Carry forward legacy vote_price if present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contests'
      AND column_name = 'vote_price'
  ) THEN
    EXECUTE $sql$
      UPDATE public.contests
      SET vote_price_ngn = COALESCE(vote_price_ngn, 0) + GREATEST(COALESCE(vote_price, 0), 0)
      WHERE COALESCE(vote_price_ngn, 0) = 0
    $sql$;
  END IF;
END $$;

-- Normalize visibility.
UPDATE public.contests
SET visibility = 'public'
WHERE visibility IS NULL OR btrim(visibility) = '';

-- Infer contest_type if still default/general.
UPDATE public.contests
SET contest_type = CASE
  WHEN lower(COALESCE(category, '')) LIKE '%music%'
    OR lower(COALESCE(name, '')) LIKE '%open mic%'
    OR lower(COALESCE(name, '')) LIKE '%one beat%'
    OR lower(COALESCE(name, '')) LIKE '%one verse%'
    THEN 'one_beat_one_verse'
  ELSE 'multi_skill'
END
WHERE contest_type IS NULL
   OR btrim(contest_type) = ''
   OR contest_type = 'general';

-- Backfill slug from name (with conflict-safe sequence suffix).
DO $$
DECLARE
  rec RECORD;
  base_slug TEXT;
  candidate_slug TEXT;
  seq_num INTEGER;
BEGIN
  FOR rec IN
    SELECT id, name
    FROM public.contests
    WHERE slug IS NULL OR btrim(slug) = ''
  LOOP
    base_slug := lower(regexp_replace(COALESCE(rec.name, ''), '[^a-zA-Z0-9\s-]', '', 'g'));
    base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
    base_slug := trim(both '-' from base_slug);
    IF base_slug = '' THEN
      base_slug := 'competition';
    END IF;

    candidate_slug := base_slug;
    seq_num := 1;

    WHILE EXISTS (
      SELECT 1
      FROM public.contests c
      WHERE c.slug = candidate_slug
        AND c.id <> rec.id
    ) LOOP
      seq_num := seq_num + 1;
      candidate_slug := base_slug || '-' || seq_num::TEXT;
    END LOOP;

    UPDATE public.contests
    SET slug = candidate_slug
    WHERE id = rec.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_slug_unique
  ON public.contests(slug)
  WHERE slug IS NOT NULL AND btrim(slug) <> '';

CREATE INDEX IF NOT EXISTS idx_contests_type_status
  ON public.contests(contest_type, status);

CREATE INDEX IF NOT EXISTS idx_contests_featured
  ON public.contests(is_featured)
  WHERE is_featured = true;

COMMIT;
