-- Restaurant & Delivery: rider assignment, rider location stream, ratings.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── orders: rider candidate (offer) + restaurant aggregate rating ────────────
-- rider_candidate_id holds the rider an order is OFFERED to; rider_id (existing)
-- is only set once that rider accepts. Both nullable & additive.
ALTER TABLE orders       ADD COLUMN IF NOT EXISTS rider_candidate_id UUID REFERENCES auth.users(id);
ALTER TABLE restaurants  ADD COLUMN IF NOT EXISTS rating NUMERIC(2,1) NOT NULL DEFAULT 5.0;

CREATE INDEX IF NOT EXISTS orders_rider_candidate_idx ON orders(rider_candidate_id);
CREATE INDEX IF NOT EXISTS orders_rider_idx           ON orders(rider_id);

-- ─── restaurant_rider_locations ───────────────────────────────────────────────
-- Append-only stream of the assigned rider's positions for an order. Pushed to
-- the order's participants in real time over the WS hub.
CREATE TABLE IF NOT EXISTS restaurant_rider_locations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rider_id   UUID NOT NULL REFERENCES auth.users(id),
    lat        DOUBLE PRECISION NOT NULL,
    lng        DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rider_locations_order_idx ON restaurant_rider_locations(order_id, created_at DESC);

-- ─── restaurant_ratings ───────────────────────────────────────────────────────
-- One rating per (order, rater). Rates the restaurant and, optionally, the rider.
CREATE TABLE IF NOT EXISTS restaurant_ratings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rater_id         UUID NOT NULL REFERENCES auth.users(id),
    restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    restaurant_stars INT  NOT NULL CHECK (restaurant_stars BETWEEN 1 AND 5),
    rider_id         UUID REFERENCES auth.users(id),
    rider_stars      INT  CHECK (rider_stars BETWEEN 1 AND 5),
    comment          TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, rater_id)
);

CREATE INDEX IF NOT EXISTS restaurant_ratings_restaurant_idx ON restaurant_ratings(restaurant_id);
CREATE INDEX IF NOT EXISTS restaurant_ratings_rider_idx      ON restaurant_ratings(rider_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE restaurant_rider_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_ratings         ENABLE ROW LEVEL SECURITY;

-- Rider locations: visible to the order's three participants; writeable only by
-- the assigned rider for that order.
CREATE POLICY "rider_locations_select" ON restaurant_rider_locations FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM orders o WHERE o.id = restaurant_rider_locations.order_id
        AND (o.customer_id = auth.uid() OR o.rider_id = auth.uid()
             OR EXISTS (SELECT 1 FROM restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid()))));

CREATE POLICY "rider_locations_insert" ON restaurant_rider_locations FOR INSERT TO authenticated
    WITH CHECK (
        rider_id = auth.uid()
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = restaurant_rider_locations.order_id AND o.rider_id = auth.uid()));

-- Ratings: readable by all (powers public restaurant rating); the customer who
-- owns the order may insert their own rating.
CREATE POLICY "restaurant_ratings_select" ON restaurant_ratings FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "restaurant_ratings_insert" ON restaurant_ratings FOR INSERT TO authenticated
    WITH CHECK (
        rater_id = auth.uid()
        AND EXISTS (SELECT 1 FROM orders o WHERE o.id = restaurant_ratings.order_id AND o.customer_id = auth.uid()));

-- Service role bypasses all RLS.
CREATE POLICY "rider_locations_service" ON restaurant_rider_locations TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "restaurant_ratings_service" ON restaurant_ratings     TO service_role USING (TRUE) WITH CHECK (TRUE);
