-- TM-005: clinical consult notes are append-only (attributable, timestamped, and
-- IMMUTABLE). Notes already carry author_id + created_at and the service only ever
-- INSERTs them, but nothing at the DB level stopped an UPDATE/DELETE. This adds the
-- append-only guard used across the codebase (arena / commission / connect): a
-- BEFORE UPDATE OR DELETE trigger that raises, so a signed clinical note can never
-- be altered or removed — a correction is a NEW note, never an edit.
--
-- ADDITIVE-ONLY: a trigger function + trigger; the table and its rows are untouched.
-- INSERTs are unaffected. No DROP, no rename, no type change. Idempotent (guards on
-- pg_proc / pg_trigger) so a replay is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'health_block_mutation') THEN
    CREATE OR REPLACE FUNCTION public.health_block_mutation() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'append-only table %: UPDATE/DELETE forbidden (a correction is a new note, never an edit)', TG_TABLE_NAME;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'health_clinical_notes_immutable') THEN
    CREATE TRIGGER health_clinical_notes_immutable
      BEFORE UPDATE OR DELETE ON public.health_clinical_notes
      FOR EACH ROW EXECUTE FUNCTION public.health_block_mutation();
  END IF;
END $$;
