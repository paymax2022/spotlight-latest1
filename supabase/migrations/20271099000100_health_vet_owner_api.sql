-- Veterinary pet-owner API: tables the owner flows persist to.
--
-- Additive only: new tables (IF NOT EXISTS) and new nullable columns on
-- vaccination_schedules. No DROP / rename / type change. Every table has RLS on,
-- an authenticated SELECT policy scoped to the owner, and a service_role ALL
-- policy (the Go backend connects as the service role; it enforces owner scoping
-- in SQL, the policies are defence in depth, same shape as pets / vet_services).

BEGIN;

-- Details the booking screen collects that the scheduling/payment rows do not carry.
CREATE TABLE IF NOT EXISTS public.vet_appointment_details (
  appointment_id     uuid PRIMARY KEY REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  owner_id           uuid NOT NULL,
  reason             text NOT NULL DEFAULT '',
  location           text NOT NULL DEFAULT '',
  intake_response_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vet_appointment_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_appt_details_owner ON public.vet_appointment_details;
CREATE POLICY vet_appt_details_owner ON public.vet_appointment_details
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS vet_appt_details_service ON public.vet_appointment_details;
CREATE POLICY vet_appt_details_service ON public.vet_appointment_details
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One review per completed appointment.
CREATE TABLE IF NOT EXISTS public.vet_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL UNIQUE REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  provider_id    uuid NOT NULL,
  owner_id       uuid NOT NULL,
  rating         smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body           text NOT NULL DEFAULT '',
  is_hidden      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vet_reviews_provider_idx ON public.vet_reviews (provider_id, created_at DESC);
ALTER TABLE public.vet_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_reviews_read ON public.vet_reviews;
CREATE POLICY vet_reviews_read ON public.vet_reviews
  FOR SELECT TO authenticated USING (NOT is_hidden OR owner_id = auth.uid());
DROP POLICY IF EXISTS vet_reviews_service ON public.vet_reviews;
CREATE POLICY vet_reviews_service ON public.vet_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Chat messages of a vet appointment's consult (owner <-> vet). Keyed by appointment
-- so the thread exists before the vet starts the consult engine session.
CREATE TABLE IF NOT EXISTS public.vet_consult_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  from_provider  boolean NOT NULL,
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vet_consult_messages_appt_idx ON public.vet_consult_messages (appointment_id, created_at);
ALTER TABLE public.vet_consult_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_consult_messages_party ON public.vet_consult_messages;
CREATE POLICY vet_consult_messages_party ON public.vet_consult_messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.health_appointments a
            LEFT JOIN public.health_providers p ON p.id = a.provider_id
            WHERE a.id = vet_consult_messages.appointment_id
              AND (a.patient_id = auth.uid() OR p.owner_user_id = auth.uid())));
DROP POLICY IF EXISTS vet_consult_messages_service ON public.vet_consult_messages;
CREATE POLICY vet_consult_messages_service ON public.vet_consult_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- HL-8: the owner's explicit acknowledgement before sensitive pet records / e-Rx are
-- shown. record_ref is the client's reference (pet:<uuid>, a prescription id, ...).
CREATE TABLE IF NOT EXISTS public.vet_record_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL,
  record_ref      text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, record_ref)
);
ALTER TABLE public.vet_record_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_record_consents_owner ON public.vet_record_consents;
CREATE POLICY vet_record_consents_owner ON public.vet_record_consents
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS vet_record_consents_service ON public.vet_record_consents;
CREATE POLICY vet_record_consents_service ON public.vet_record_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Per-item prescription detail the rx engine's item row does not carry (form,
-- frequency, duration, instructions). Written by whoever issues the e-Rx.
CREATE TABLE IF NOT EXISTS public.vet_rx_item_details (
  item_id       uuid PRIMARY KEY REFERENCES public.health_prescription_items(id) ON DELETE CASCADE,
  form          text NOT NULL DEFAULT '',
  frequency     text NOT NULL DEFAULT '',
  duration_days integer NOT NULL DEFAULT 0 CHECK (duration_days >= 0),
  instructions  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vet_rx_item_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_rx_item_details_service ON public.vet_rx_item_details;
CREATE POLICY vet_rx_item_details_service ON public.vet_rx_item_details
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Free-text extras of a completed consult's summary the clinical note has no column
-- for (diagnosis label, follow-up recommendation). Written by the vet's completion flow.
CREATE TABLE IF NOT EXISTS public.vet_consult_summary_extras (
  consult_id            uuid PRIMARY KEY REFERENCES public.health_consults(id) ON DELETE CASCADE,
  diagnosis             text NOT NULL DEFAULT '',
  follow_up_recommended boolean NOT NULL DEFAULT false,
  follow_up_note        text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vet_consult_summary_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_consult_summary_extras_service ON public.vet_consult_summary_extras;
CREATE POLICY vet_consult_summary_extras_service ON public.vet_consult_summary_extras
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- An owner's request to refill a prescribed medication (no payment is taken here;
-- the vet / pharmacy fulfils it).
CREATE TABLE IF NOT EXISTS public.vet_refill_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES public.health_prescription_items(id) ON DELETE CASCADE,
  prescription_id uuid NOT NULL,
  owner_id        uuid NOT NULL,
  status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','declined','fulfilled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One open request per medication.
CREATE UNIQUE INDEX IF NOT EXISTS vet_refill_requests_open_ux
  ON public.vet_refill_requests (item_id, owner_id) WHERE status = 'requested';
ALTER TABLE public.vet_refill_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_refill_requests_owner ON public.vet_refill_requests;
CREATE POLICY vet_refill_requests_owner ON public.vet_refill_requests
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS vet_refill_requests_service ON public.vet_refill_requests;
CREATE POLICY vet_refill_requests_service ON public.vet_refill_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Vaccinations: the owner can pick the date a dose is booked for, and attach notes.
ALTER TABLE public.vaccination_schedules ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.vaccination_schedules ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

COMMIT;
