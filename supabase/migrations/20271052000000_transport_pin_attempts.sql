-- Attempt limiting for transport hand-off PINs (ride start, parcel pickup and
-- drop-off, business-delivery drop-off, towing). ADDITIVE-ONLY: one new table.
--
-- The PINs are 4 digits and every verify endpoint accepted unlimited guesses,
-- so an assigned courier could script all 10,000 values at a parcel's
-- drop-off, mark it delivered without the receiver, and have the fare escrow
-- settle to themselves. The Go guard (transport/pin_attempts.go) counts
-- failures per (entity, purpose): a cooldown after every 5 failures, a hard
-- lock after 15 that only support clears. A correct PIN resets the count.

CREATE TABLE IF NOT EXISTS public.transport_pin_attempts (
  entity_type   text        NOT NULL,   -- trip | parcel | business_delivery | towing_job
  entity_id     text        NOT NULL,
  purpose       text        NOT NULL,   -- start | pickup | dropoff
  failed_count  integer     NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  locked_until  timestamptz,
  hard_locked   boolean     NOT NULL DEFAULT false,
  last_actor_id uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, purpose)
);

CREATE INDEX IF NOT EXISTS idx_transport_pin_attempts_hard_locked
  ON public.transport_pin_attempts (updated_at) WHERE hard_locked;

-- Backend-only: reached through the Go service, never the public API.
ALTER TABLE public.transport_pin_attempts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'transport_pin_attempts' AND policyname = 'transport_pin_attempts_service') THEN
    CREATE POLICY "transport_pin_attempts_service" ON public.transport_pin_attempts
      TO service_role USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;
