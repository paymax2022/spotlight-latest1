-- Migration: stays_messages — guest <-> hotel messaging thread per reservation.
-- Additive only: a new table. Replaces the extranet messaging stub with durable
-- persistence. Non-money. A thread is scoped to a reservation; the guest who owns
-- the reservation and the hotelier(s) on the property may read/write it. RLS scopes
-- reads to those parties; writes go through the service (service_role) which does
-- the object-level authorization in Go before inserting.

CREATE TABLE IF NOT EXISTS public.stays_message (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  property_id    uuid,
  sender_role    text NOT NULL CHECK (sender_role IN ('guest','host','system')),
  sender_user_id uuid,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_stays_message_res_created
  ON public.stays_message (reservation_id, created_at);

ALTER TABLE public.stays_message ENABLE ROW LEVEL SECURITY;

-- The guest who owns the reservation may read their thread.
DO $$ BEGIN
  CREATE POLICY "stays_message_guest_read" ON public.stays_message
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.stays_reservation r
        WHERE r.id = stays_message.reservation_id
          AND r.guest_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A hotelier with an ACTIVE grant on the property may read the thread.
DO $$ BEGIN
  CREATE POLICY "stays_message_host_read" ON public.stays_message
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.stays_hotelier_profile hp
        WHERE hp.property_id = stays_message.property_id
          AND hp.user_id = auth.uid()
          AND hp.status = 'ACTIVE'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writes + full access go through the service_role (the Go service performs the
-- object-level authorization before inserting; the client never writes directly).
DO $$ BEGIN
  CREATE POLICY "stays_message_service" ON public.stays_message
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
