-- Transport hailing (Block 14): drivers + trips for request -> match -> complete -> settle.
-- ADDITIVE ONLY: two new tables; nothing dropped, renamed or narrowed.
-- All money is integer kobo. Settlement posts to the ledger (no balance columns here).
BEGIN;

CREATE TABLE IF NOT EXISTS public.transport_drivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES public.platform_users(id),
  status      text NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','available','busy')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transport_drivers_status ON public.transport_drivers (status);

CREATE TABLE IF NOT EXISTS public.transport_trips (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id            uuid NOT NULL REFERENCES public.platform_users(id),
  driver_id           uuid REFERENCES public.transport_drivers(id),
  pickup_lat          double precision NOT NULL,
  pickup_lon          double precision NOT NULL,
  dropoff_lat         double precision NOT NULL,
  dropoff_lon         double precision NOT NULL,
  status              text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','matched','completed','cancelled')),
  base_fare_kobo      bigint NOT NULL CHECK (base_fare_kobo > 0),
  surge_bps           integer NOT NULL DEFAULT 10000 CHECK (surge_bps BETWEEN 10000 AND 20000),
  fare_kobo           bigint NOT NULL CHECK (fare_kobo > 0),
  driver_share_kobo   bigint,
  platform_share_kobo bigint,
  idempotency_key     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  matched_at          timestamptz,
  completed_at        timestamptz,
  CONSTRAINT transport_trips_split_ck CHECK (
    driver_share_kobo IS NULL OR driver_share_kobo + platform_share_kobo = fare_kobo)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_trips_rider_idem
  ON public.transport_trips (rider_id, idempotency_key);
-- DB-level backstop to the Redlock: a driver can hold at most one open trip.
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_trips_driver_open
  ON public.transport_trips (driver_id) WHERE status = 'matched';
CREATE INDEX IF NOT EXISTS idx_transport_trips_status ON public.transport_trips (status);

ALTER TABLE public.transport_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_trips   ENABLE ROW LEVEL SECURITY;

COMMIT;
