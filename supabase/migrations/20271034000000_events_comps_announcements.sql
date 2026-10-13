-- Events organiser self-service, Phase 3: comp tickets + attendee announcements.
-- ADDITIVE ONLY (IF NOT EXISTS). Flag-gated at the application layer.
BEGIN;

ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'PAID';
-- Add the CHECK only if absent (idempotent without a DROP — additive-only chain).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_orders_kind_check' AND conrelid = 'public.event_orders'::regclass
  ) THEN
    ALTER TABLE public.event_orders
      ADD CONSTRAINT event_orders_kind_check CHECK (kind IN ('PAID','COMP'));
  END IF;
END $$;

ALTER TABLE public.event_tickets
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS issued_by uuid NULL REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS comp_note text NULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_tickets_kind_check' AND conrelid = 'public.event_tickets'::regclass
  ) THEN
    ALTER TABLE public.event_tickets
      ADD CONSTRAINT event_tickets_kind_check CHECK (kind IN ('PAID','COMP'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.event_announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES auth.users(id),
  channel         text NOT NULL,
  subject         text NOT NULL DEFAULT '',
  body            text NOT NULL,
  recipient_count int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_announcements_event
  ON public.event_announcements (event_id, created_at DESC);

ALTER TABLE public.event_announcements ENABLE ROW LEVEL SECURITY;

-- Mirrors event_team_members: backend uses a direct owner connection (bypasses RLS);
-- these policies cover any PostgREST/supabase-js access.
DROP POLICY IF EXISTS event_announcements_read ON public.event_announcements;
CREATE POLICY event_announcements_read ON public.event_announcements
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_announcements.event_id AND e.organiser_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_announcements_service ON public.event_announcements;
CREATE POLICY event_announcements_service ON public.event_announcements
  TO service_role USING (true) WITH CHECK (true);

COMMIT;
