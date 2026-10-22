-- Doctor-console bridge: a consult started from the doctor console mirrors
-- 'in_progress' onto the linked telemedicine appointment before it completes.
-- Widen the status CHECK (additive; no existing row changes state).
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status = ANY (ARRAY['booked'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]));
