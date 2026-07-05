-- Restaurant & Delivery: per-order chat between the three participants
-- (customer, restaurant owner, assigned rider).
-- Additive-only — no DROP, no RENAME, no type narrowing.

CREATE TABLE IF NOT EXISTS restaurant_order_messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sender_id      UUID NOT NULL REFERENCES auth.users(id),
    sender_role    TEXT NOT NULL CHECK (sender_role IN ('customer','restaurant','rider')),
    body           TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    attachment_url TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS restaurant_order_messages_order_idx ON restaurant_order_messages(order_id, created_at);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Messages are scoped to the order's three participants: the customer, the
-- restaurant owner, and the assigned rider. A participant may read the whole
-- thread; a participant may post only as themselves (sender_id = auth.uid()).
ALTER TABLE restaurant_order_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_messages_select" ON restaurant_order_messages FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM orders o WHERE o.id = restaurant_order_messages.order_id
        AND (o.customer_id = auth.uid() OR o.rider_id = auth.uid()
             OR EXISTS (SELECT 1 FROM restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid()))));

CREATE POLICY "order_messages_insert" ON restaurant_order_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM orders o WHERE o.id = restaurant_order_messages.order_id
            AND (o.customer_id = auth.uid() OR o.rider_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid()))));

CREATE POLICY "order_messages_service" ON restaurant_order_messages TO service_role USING (TRUE) WITH CHECK (TRUE);
