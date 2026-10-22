-- FOOD-UAT Wave 7 polish (additive-only).
--   C-010  per-restaurant service-fee floor / cap / rounding policy
--   F-005b dispute evidence attachments
--   F-006  rider incident / unsafe drop-off reports
BEGIN;

-- C-010 ---------------------------------------------------------------------
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_fee_min_kobo   BIGINT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_fee_max_kobo   BIGINT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS service_fee_round_mode TEXT NOT NULL DEFAULT 'none';
DO $$ BEGIN
  ALTER TABLE restaurants ADD CONSTRAINT restaurants_service_fee_round_mode_chk
    CHECK (service_fee_round_mode IN ('none','nearest_naira','up_naira','down_naira'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE restaurants ADD CONSTRAINT restaurants_service_fee_bounds_chk
    CHECK ((service_fee_min_kobo IS NULL OR service_fee_min_kobo >= 0)
       AND (service_fee_max_kobo IS NULL OR service_fee_max_kobo >= 0)
       AND (service_fee_min_kobo IS NULL OR service_fee_max_kobo IS NULL OR service_fee_min_kobo <= service_fee_max_kobo));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- F-005b --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_dispute_evidence (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   UUID NOT NULL,
  uploader_id  UUID NOT NULL,
  url          TEXT NOT NULL CHECK (url ~* '^https?://'),
  caption      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_dispute_evidence_dispute_idx ON restaurant_dispute_evidence(dispute_id, created_at);
ALTER TABLE restaurant_dispute_evidence ENABLE ROW LEVEL SECURITY;

-- F-006 ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_rider_incidents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL,
  rider_id     UUID NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('unsafe_dropoff','accident','harassment','theft','other')),
  description  TEXT NOT NULL,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_rider_incidents_order_idx ON restaurant_rider_incidents(order_id);
CREATE INDEX IF NOT EXISTS restaurant_rider_incidents_open_idx ON restaurant_rider_incidents(status, created_at DESC);
ALTER TABLE restaurant_rider_incidents ENABLE ROW LEVEL SECURITY;

COMMIT;
