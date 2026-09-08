-- Per-event steward grants for ticket check-in, and the check-in timestamp
-- ScanTicket needs to stamp.
--
-- WHY: today ANY authenticated user can call POST /scan and validate/consume ANY
-- ticket at ANY event — ScanTicket has no caller/event authorization at all. This
-- module's own documented philosophy (top5events/model.go: "the organiser is a
-- capability on a single identity — object-level authZ is auth.uid() ==
-- organiser_id") argues against a new global RBAC permission here: scanning
-- rights are inherently per-event (an organiser's staff for ONE event, not a
-- platform-wide "can scan tickets" grant), so this is a small grant table rather
-- than a role. Only the organiser may add/remove stewards — a steward cannot
-- manage other stewards, so this is not a privilege-escalation chain; added_by is
-- captured for audit only, never read as an authorization input.
--
-- SAFETY: additive-only per CLAUDE.md. New table + new column, both nullable/
-- defaulted where relevant. No DROP, no rename, no type narrowing. Re-runnable
-- (CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF
-- EXISTS before each CREATE POLICY).

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_stewards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by   uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_stewards_event ON public.event_stewards (event_id);
CREATE INDEX IF NOT EXISTS idx_event_stewards_user  ON public.event_stewards (user_id, event_id);

-- ScanTicket (service layer) stamps this on an accepted scan; the organiser's
-- attendee list reads it directly rather than re-deriving check-in state.
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

ALTER TABLE public.event_stewards ENABLE ROW LEVEL SECURITY;

-- Backend reaches this table over a direct pgx connection as the table owner
-- (bypasses RLS), same as every other top5events table — these policies are for
-- any future PostgREST/supabase-js access, not the Go service path itself.
DROP POLICY IF EXISTS event_stewards_read ON public.event_stewards;
CREATE POLICY event_stewards_read ON public.event_stewards
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_stewards.event_id AND e.organiser_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_stewards_service ON public.event_stewards;
CREATE POLICY event_stewards_service ON public.event_stewards
  TO service_role USING (true) WITH CHECK (true);

COMMIT;
