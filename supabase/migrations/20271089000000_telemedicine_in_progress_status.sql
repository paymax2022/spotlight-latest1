-- Doctor-console bridge (ADR-PR879): a consult started from the doctor console
-- mirrors 'in_progress' onto the linked telemedicine appointment before it
-- completes. Widen the appointments status CHECK. Widening only: no existing row
-- changes state, and every value the old CHECK allowed is still allowed.
--
-- The original CHECK was declared inline (20260616280000_telemedicine.sql), so its
-- name is auto-generated. Find it through pg_constraint rather than assuming the
-- name: dropping a guessed name would silently leave the old CHECK in place in an
-- environment where it differs, and every in_progress update would then fail.
-- Idempotent: once the widened CHECK exists, nothing changes.
DO $$
DECLARE
    c record;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = 'public.appointments'::regclass
                 AND conname = 'appointments_status_check'
                 AND pg_get_constraintdef(oid) LIKE '%in_progress%') THEN
        RETURN;
    END IF;
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.appointments'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ '\mstatus\M' AND pg_get_constraintdef(oid) LIKE '%booked%'
    LOOP
        EXECUTE format('ALTER TABLE public.appointments DROP CONSTRAINT %I', c.conname);
    END LOOP;
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
        CHECK (status = ANY (ARRAY['booked'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]));
END $$;
