-- Prevent applicants from applying to the same Film Academy batch more than once.
-- This avoids relying only on the web API and does not fail if historical duplicates exist.

CREATE OR REPLACE FUNCTION public.prevent_duplicate_academy_batch_application()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.academy_applications AS existing
    WHERE existing.batch_id = NEW.batch_id
      AND existing.id <> NEW.id
      AND (
        (NEW.user_id IS NOT NULL AND existing.user_id = NEW.user_id)
        OR (
          NULLIF(BTRIM(NEW.email), '') IS NOT NULL
          AND LOWER(existing.email) = LOWER(NEW.email)
        )
      )
  ) THEN
    RAISE EXCEPTION 'You have already applied for this Film Academy batch.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_academy_batch_application
ON public.academy_applications;

CREATE TRIGGER prevent_duplicate_academy_batch_application
  BEFORE INSERT OR UPDATE OF batch_id, user_id, email
  ON public.academy_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_academy_batch_application();
