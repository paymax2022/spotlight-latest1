-- Events organiser self-service, Phase 1 (edit & lifecycle): schema.
--
-- Adds: PAUSED/CANCELLED event states, cancel audit columns, a 10% default
-- platform fee for NEW events, and per-event team grants (MANAGER/FINANCE).
--
-- SAFETY: additive-only. The state CHECK is widened in place (every prior value
-- stays allowed; drop+add broader is the sanctioned widening). No column
-- dropped/renamed/narrowed. fee_bps default changes only for future inserts;
-- existing rows keep their stored value. Re-runnable.

BEGIN;

-- Widen events.state. Name-agnostic: the legacy events migration path may have
-- named (or shaped) the state CHECK differently, so drop every CHECK on
-- public.events that references the state column, then add the canonical one.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%state%'
  LOOP
    EXECUTE format('ALTER TABLE public.events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.events ADD CONSTRAINT events_state_check
  CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','LIVE','CLOSED','SUSPENDED','PAUSED','CANCELLED'));

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.events ALTER COLUMN fee_bps SET DEFAULT 1000;

CREATE TABLE IF NOT EXISTS public.event_team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('MANAGER','FINANCE')),
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_team_members_event_user_role
  ON public.event_team_members (event_id, user_id, role);
CREATE INDEX IF NOT EXISTS idx_event_team_members_user
  ON public.event_team_members (user_id, event_id);

ALTER TABLE public.event_team_members ENABLE ROW LEVEL SECURITY;

-- Mirrors event_stewards: backend uses a direct owner connection (bypasses RLS);
-- these policies cover any PostgREST/supabase-js access.
DROP POLICY IF EXISTS event_team_members_read ON public.event_team_members;
CREATE POLICY event_team_members_read ON public.event_team_members
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_team_members.event_id AND e.organiser_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS event_team_members_service ON public.event_team_members;
CREATE POLICY event_team_members_service ON public.event_team_members
  TO service_role USING (true) WITH CHECK (true);

COMMIT;
