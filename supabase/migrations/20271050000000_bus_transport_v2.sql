-- Bus Transport v2 — additive-only. No DROP/renames; legacy bus_* tables untouched.
-- Adds: shared geography, route templates w/ multi-stop + to-and-fro pairing,
-- OD-pair fare matrix, seat layouts, dated departures, segment-overlap occupancy,
-- seat holds, booking legs + third-party passengers, secure ticket tokens.
BEGIN;

-- Geography reference data
CREATE TABLE IF NOT EXISTS public.bus_geo_state (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- e.g. 'LA','FC','AN'
  name        TEXT NOT NULL UNIQUE,          -- 'Lagos', 'Federal Capital Territory', ...
  active      BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS public.bus_geo_city (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id    SMALLINT NOT NULL REFERENCES public.bus_geo_state(id),
  name        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (state_id, name)
);
CREATE TABLE IF NOT EXISTS public.bus_terminal (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     UUID NOT NULL REFERENCES public.bus_geo_city(id),
  name        TEXT NOT NULL,
  address     TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  operator_id UUID,                          -- NULL = platform-owned terminal
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','active','inactive','merged')),
  merged_into UUID REFERENCES public.bus_terminal(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bus_terminal_city_idx ON public.bus_terminal (city_id, status);

-- Route templates (directional; return is its own row linked both ways)
CREATE TABLE IF NOT EXISTS public.bus_route_template (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  one_way_only    BOOLEAN NOT NULL DEFAULT FALSE,
  return_route_id UUID REFERENCES public.bus_route_template(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, code, version)
);
CREATE TABLE IF NOT EXISTS public.bus_route_stop (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        UUID NOT NULL REFERENCES public.bus_route_template(id) ON DELETE CASCADE,
  seq             SMALLINT NOT NULL,          -- 1..n ordered
  terminal_id     UUID NOT NULL REFERENCES public.bus_terminal(id),
  arrive_offset_min INTEGER,                  -- minutes after route start; NULL for origin
  depart_offset_min INTEGER NOT NULL,         -- boarding close/departure offset
  board_allowed   BOOLEAN NOT NULL DEFAULT TRUE,
  alight_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (route_id, seq)
);
CREATE TABLE IF NOT EXISTS public.bus_route_fare (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id     UUID NOT NULL REFERENCES public.bus_route_template(id) ON DELETE CASCADE,
  from_seq     SMALLINT NOT NULL,
  to_seq       SMALLINT NOT NULL,
  amount_kobo  BIGINT NOT NULL CHECK (amount_kobo > 0),
  currency     TEXT NOT NULL DEFAULT 'NGN',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to   DATE,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_seq < to_seq),
  UNIQUE (route_id, from_seq, to_seq, effective_from)
);

-- Fleet + seat layouts (versioned; booked departures pin layout_version)
CREATE TABLE IF NOT EXISTS public.bus_seat_layout (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL,
  name        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  decks       SMALLINT NOT NULL DEFAULT 1,
  rows_count  SMALLINT NOT NULL,
  cols_count  SMALLINT NOT NULL,
  capacity    SMALLINT NOT NULL CHECK (capacity > 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, name, version)
);
CREATE TABLE IF NOT EXISTS public.bus_seat_layout_seat (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layout_id  UUID NOT NULL REFERENCES public.bus_seat_layout(id) ON DELETE CASCADE,
  seat_key   TEXT NOT NULL,              -- stable internal id per layout version
  label      TEXT NOT NULL,              -- display: A1, B2 ...
  deck       SMALLINT NOT NULL DEFAULT 1,
  row_no     SMALLINT NOT NULL,
  col_no     SMALLINT NOT NULL,
  seat_type  TEXT NOT NULL DEFAULT 'standard'
             CHECK (seat_type IN ('standard','premium','accessible','driver','blocked')),
  bookable   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (layout_id, seat_key),
  UNIQUE (layout_id, deck, row_no, col_no)
);
CREATE TABLE IF NOT EXISTS public.bus_vehicle (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL,
  plate_number TEXT NOT NULL,
  fleet_code   TEXT,
  make_model   TEXT,
  capacity     SMALLINT NOT NULL CHECK (capacity > 0),
  layout_id    UUID NOT NULL REFERENCES public.bus_seat_layout(id),
  status       TEXT NOT NULL DEFAULT 'available'
               CHECK (status IN ('available','assigned','maintenance','retired')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, plate_number)
);

-- Dated departures w/ frozen itinerary+fare snapshot
CREATE TABLE IF NOT EXISTS public.bus_departure (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    UUID NOT NULL,
  route_id       UUID NOT NULL REFERENCES public.bus_route_template(id),
  route_version  INTEGER NOT NULL,
  travel_date    DATE NOT NULL,
  depart_at      TIMESTAMPTZ NOT NULL,
  vehicle_id     UUID REFERENCES public.bus_vehicle(id),
  layout_id      UUID REFERENCES public.bus_seat_layout(id),
  layout_version INTEGER,
  capacity       SMALLINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('draft','scheduled','published','boarding','departed',
                                   'arrived','delayed','cancelled','completed','no_show')),
  booking_cutoff_minutes SMALLINT NOT NULL DEFAULT 60,
  cancel_cutoff_minutes  SMALLINT NOT NULL DEFAULT 120,
  itinerary_snapshot JSONB NOT NULL,     -- ordered stops w/ terminal names/times
  fare_snapshot      JSONB NOT NULL,     -- OD matrix as sold
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, travel_date, depart_at)
);
CREATE INDEX IF NOT EXISTS bus_departure_search_idx
  ON public.bus_departure (status, travel_date, route_id);
CREATE INDEX IF NOT EXISTS bus_departure_provider_idx
  ON public.bus_departure (provider_id, travel_date);

-- Seat holds (TTL) + segment-overlap occupancy
CREATE TABLE IF NOT EXISTS public.bus_seat_hold (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id  UUID NOT NULL REFERENCES public.bus_departure(id) ON DELETE CASCADE,
  seat_key      TEXT NOT NULL,
  from_seq      SMALLINT NOT NULL,
  to_seq        SMALLINT NOT NULL,
  owner_user_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  state         TEXT NOT NULL DEFAULT 'held'
                CHECK (state IN ('held','consumed','released','expired')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_seq < to_seq),
  UNIQUE (departure_id, seat_key, from_seq, to_seq, idempotency_key)
);
CREATE INDEX IF NOT EXISTS bus_seat_hold_exp_idx ON public.bus_seat_hold (expires_at) WHERE state='held';
-- Occupancy: one row per (departure, seat, segment). Overlap prevented by txn-level
-- lock on the seat's existing rows + explicit overlap predicate before insert
-- (documented in businventory service; partial unique can't express intervals).
CREATE TABLE IF NOT EXISTS public.bus_seat_occupancy (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  departure_id  UUID NOT NULL REFERENCES public.bus_departure(id) ON DELETE CASCADE,
  seat_key      TEXT NOT NULL,
  from_seq      SMALLINT NOT NULL,
  to_seq        SMALLINT NOT NULL,
  booking_id    UUID NOT NULL,
  ticket_id     UUID,
  state         TEXT NOT NULL DEFAULT 'occupied'
                CHECK (state IN ('occupied','released')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_seq < to_seq)
);
CREATE INDEX IF NOT EXISTS bus_seat_occ_lookup_idx
  ON public.bus_seat_occupancy (departure_id, seat_key) WHERE state='occupied';

-- Bookings: group + legs (one-way/return) + passengers + tickets
CREATE TABLE IF NOT EXISTS public.bus_booking (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref            TEXT NOT NULL UNIQUE,              -- public reference, non-guessable
  purchaser_id   UUID NOT NULL,
  provider_id    UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL DEFAULT 'quoted'
                 CHECK (state IN ('quoted','inventory_held','payment_pending','confirmed',
                                  'cancel_requested','cancelled','change_requested',
                                  'partially_refunded','refund_pending','refunded',
                                  'expired','payment_failed','exception_review')),
  total_kobo     BIGINT NOT NULL CHECK (total_kobo >= 0),
  currency       TEXT NOT NULL DEFAULT 'NGN',
  fare_snapshot  JSONB NOT NULL,
  policy_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.bus_booking_leg (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES public.bus_booking(id) ON DELETE CASCADE,
  departure_id  UUID NOT NULL REFERENCES public.bus_departure(id),
  from_seq      SMALLINT NOT NULL,
  to_seq        SMALLINT NOT NULL,
  fare_kobo     BIGINT NOT NULL CHECK (fare_kobo >= 0),
  state         TEXT NOT NULL DEFAULT 'payment_pending'
                CHECK (state IN ('payment_pending','confirmed','cancelled','refunded','failed')),
  CHECK (from_seq < to_seq)
);
CREATE TABLE IF NOT EXISTS public.bus_booking_passenger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_leg_id UUID NOT NULL REFERENCES public.bus_booking_leg(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  seat_key      TEXT NOT NULL,
  deliver_to    TEXT NOT NULL DEFAULT 'purchaser'
                CHECK (deliver_to IN ('purchaser','traveller','both')),
  ticket_id     UUID
);
CREATE TABLE IF NOT EXISTS public.bus_ticket_v2 (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'), -- non-guessable
  passenger_id UUID NOT NULL REFERENCES public.bus_booking_passenger(id) ON DELETE CASCADE,
  booking_leg_id UUID NOT NULL REFERENCES public.bus_booking_leg(id),
  status      TEXT NOT NULL DEFAULT 'issued'
              CHECK (status IN ('issued','checked_in','boarded','used','cancelled','refunded')),
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID,
  checkin_stop_seq SMALLINT
);
CREATE INDEX IF NOT EXISTS bus_ticket_v2_leg_idx ON public.bus_ticket_v2 (booking_leg_id);

COMMIT;
