-- Paid consult sessions shared by telemedicine, vet, pharmacy and lab.
-- ADDITIVE-ONLY: four new tables, nothing existing altered.
-- RLS is enabled with NO anon/authenticated policies by design: every read and
-- write goes through the Go pool, which owns participant scoping.
BEGIN;

CREATE TABLE IF NOT EXISTS public.consult_session_packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind        text NOT NULL CHECK (owner_kind IN ('doctor','health_provider')),
  owner_id          uuid NOT NULL,
  vertical          text NOT NULL CHECK (vertical IN ('telemedicine','vet','pharmacy','lab')),
  mode              text NOT NULL CHECK (mode IN ('chat','voice','video')),
  duration_minutes  int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price_kobo        bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_packages_owner
  ON public.consult_session_packages (owner_kind, owner_id, vertical, mode, duration_minutes);
CREATE INDEX IF NOT EXISTS idx_consult_packages_lookup
  ON public.consult_session_packages (vertical, owner_kind, owner_id, active);

CREATE TABLE IF NOT EXISTS public.consult_sessions (
  id                   uuid PRIMARY KEY,
  vertical             text NOT NULL CHECK (vertical IN ('telemedicine','vet','pharmacy','lab')),
  mode                 text NOT NULL CHECK (mode IN ('chat','voice','video')),
  patient_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_owner_kind  text NOT NULL CHECK (provider_owner_kind IN ('doctor','health_provider')),
  provider_owner_id    uuid NOT NULL,
  provider_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_ref           text NOT NULL CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),
  package_id           uuid REFERENCES public.consult_session_packages(id) ON DELETE SET NULL,
  duration_minutes     int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  price_kobo           bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  booked_start         timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  warn_at              timestamptz NOT NULL,
  warning_sent_at      timestamptz,
  state                text NOT NULL DEFAULT 'scheduled'
                       CHECK (state IN ('scheduled','live','ended','cancelled')),
  room_name            text NOT NULL UNIQUE,
  base_hold_id         text,
  ended_at             timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > booked_start),
  CHECK (warn_at >= booked_start AND warn_at <= ends_at)
);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_patient
  ON public.consult_sessions (patient_id, booked_start DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_provider
  ON public.consult_sessions (provider_user_id, booked_start DESC);
CREATE INDEX IF NOT EXISTS idx_consult_sessions_due
  ON public.consult_sessions (state, ends_at);

CREATE TABLE IF NOT EXISTS public.consult_extension_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES public.consult_sessions(id) ON DELETE CASCADE,
  requested_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_minutes       int  NOT NULL CHECK (added_minutes BETWEEN 1 AND 240),
  price_kobo          bigint NOT NULL CHECK (price_kobo BETWEEN 0 AND 100000000),
  status              text NOT NULL CHECK (status IN
                        ('pending_approval','approved_awaiting_payment',
                         'paid','declined','expired','cancelled')),
  approved_at         timestamptz,
  payment_expires_at  timestamptz,
  paid_at             timestamptz,
  escrow_id           text,
  released_at         timestamptz,
  decided_by          uuid,
  decline_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_consult_extension_open
  ON public.consult_extension_requests (session_id)
  WHERE status IN ('pending_approval','approved_awaiting_payment');
CREATE INDEX IF NOT EXISTS idx_consult_extension_unreleased
  ON public.consult_extension_requests (session_id, status, released_at);

CREATE TABLE IF NOT EXISTS public.consult_session_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.consult_sessions(id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consult_messages_session
  ON public.consult_session_messages (session_id, created_at ASC);

ALTER TABLE public.consult_session_packages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_extension_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_session_messages    ENABLE ROW LEVEL SECURITY;

COMMIT;
