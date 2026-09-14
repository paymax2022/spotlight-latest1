-- Mobility: per-trip chat between the rider and the assigned driver.
-- Additive-only — no DROP, no RENAME, no type narrowing.
--
-- Complements the trip PIN (an at-the-door identity check the rider reads
-- aloud and the driver enters): chat is for pre-arrival logistics — "I'm
-- outside", "which gate", "is this the right address" — not a payment or
-- identity gate. Mirrors restaurant_order_messages (backend/internal/restaurant
-- /messages.go), narrowed to mobility's two participants (no third "owner").

CREATE TABLE IF NOT EXISTS trip_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id        UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    sender_id      UUID NOT NULL REFERENCES auth.users(id),
    sender_role    TEXT NOT NULL CHECK (sender_role IN ('rider','driver')),
    body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    attachment_url TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trip_messages_trip_idx ON trip_messages(trip_id, created_at);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Messages are scoped to the trip's two participants: the rider and the
-- assigned driver (mirrors the trips_select join pattern in
-- 20260616290000_transport.sql). A participant may read the whole thread; a
-- participant may post only as themselves (sender_id = auth.uid()).
ALTER TABLE trip_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_messages_select" ON trip_messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM trips t WHERE t.id = trip_messages.trip_id
        AND (t.rider_id = auth.uid()
             OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = t.driver_id AND d.user_id = auth.uid()))));

CREATE POLICY "trip_messages_insert" ON trip_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM trips t WHERE t.id = trip_messages.trip_id
            AND (t.rider_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM drivers d WHERE d.id = t.driver_id AND d.user_id = auth.uid()))));

CREATE POLICY "trip_messages_service" ON trip_messages TO service_role USING (TRUE) WITH CHECK (TRUE);
