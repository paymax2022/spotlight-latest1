-- Multi-restaurant order support (P0).
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── order_restaurant_items ────────────────────────────────────────────────
-- Maps each order_item to its source restaurant, enabling split-kitchen workflow.
-- An order can span multiple restaurants; each item knows where it comes from.
CREATE TABLE IF NOT EXISTS order_restaurant_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_item_id) -- each order_item has exactly one restaurant source
);

CREATE INDEX IF NOT EXISTS order_restaurant_items_order_idx ON order_restaurant_items(order_id);
CREATE INDEX IF NOT EXISTS order_restaurant_items_restaurant_idx ON order_restaurant_items(restaurant_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE order_restaurant_items ENABLE ROW LEVEL SECURITY;

-- Restaurants can see items from their own orders; customers/riders see via order visibility.
CREATE POLICY "order_restaurant_items_select" ON order_restaurant_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = order_restaurant_items.order_id
            AND (o.customer_id = auth.uid()
                 OR o.rider_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM restaurants r
                           WHERE r.id = order_restaurant_items.restaurant_id
                           AND r.owner_id = auth.uid()))
        )
    );

CREATE POLICY "order_restaurant_items_service" ON order_restaurant_items TO service_role USING (TRUE) WITH CHECK (TRUE);
