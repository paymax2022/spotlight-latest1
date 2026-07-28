-- =============================================================================
-- Add slug column to competition_enrollments for clean voting URLs
-- Migration: 20260602120000_contestant_voting_slug
-- =============================================================================

BEGIN;

-- Add slug column (nullable; backfilled below)
ALTER TABLE public.competition_enrollments
  ADD COLUMN IF NOT EXISTS slug text;

-- Helper: generate URL-safe slug from a name
CREATE OR REPLACE FUNCTION public.slugify(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN lower(
    regexp_replace(
      regexp_replace(
        trim(input),
        '[^a-zA-Z0-9\s-]', '', 'g'  -- strip non-alphanumeric except spaces/dashes
      ),
      '[\s-]+', '-', 'g'             -- collapse spaces/dashes to single dash
    )
  );
END;
$$;

-- Backfill slugs from stage_name (falling back to id)
UPDATE public.competition_enrollments
SET slug = COALESCE(
  NULLIF(public.slugify(stage_name), ''),
  'contestant-' || LEFT(id::text, 8)
)
WHERE slug IS NULL;

-- Ensure slug is unique per contest; resolve collisions by appending short id suffix
-- Run a second pass to fix any duplicates introduced by common names
WITH dupes AS (
  SELECT id, competition_id, slug,
    ROW_NUMBER() OVER (PARTITION BY competition_id, slug ORDER BY enrolled_at) AS rn
  FROM public.competition_enrollments
  WHERE slug IS NOT NULL
)
UPDATE public.competition_enrollments e
SET slug = d.slug || '-' || LEFT(e.id::text, 6)
FROM dupes d
WHERE e.id = d.id AND d.rn > 1;

-- Add unique constraint on (competition_id, slug). Postgres has no
-- "ADD CONSTRAINT IF NOT EXISTS", so guard it for idempotent replay.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_enrollment_contest_slug'
  ) THEN
    ALTER TABLE public.competition_enrollments
      ADD CONSTRAINT uq_enrollment_contest_slug UNIQUE (competition_id, slug);
  END IF;
END$$;

-- Auto-set slug on insert when not provided
CREATE OR REPLACE FUNCTION public.set_enrollment_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug text;
  candidate text;
  counter   int := 0;
BEGIN
  IF NEW.slug IS NOT NULL AND NEW.slug <> '' THEN
    RETURN NEW;
  END IF;

  base_slug := COALESCE(
    NULLIF(public.slugify(NEW.stage_name), ''),
    'contestant-' || LEFT(NEW.id::text, 8)
  );

  candidate := base_slug;
  LOOP
    BEGIN
      -- Attempt; if unique constraint fires we catch it below
      NEW.slug := candidate;
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      counter := counter + 1;
      candidate := base_slug || '-' || counter;
    END;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollment_slug ON public.competition_enrollments;
CREATE TRIGGER trg_enrollment_slug
  BEFORE INSERT ON public.competition_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.set_enrollment_slug();

COMMIT;
