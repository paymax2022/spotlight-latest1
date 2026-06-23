-- Restaurant & Delivery module.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── restaurants ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES auth.users(id),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
    description TEXT,
    address     TEXT NOT NULL,
    logo_url    TEXT,
    is_open     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS restaurants_owner_idx  ON restaurants(owner_id);
CREATE INDEX IF NOT EXISTS restaurants_is_open_idx ON restaurants(is_open);

-- ─── menu_categories ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_categories_restaurant_idx ON menu_categories(restaurant_id);

-- ─── menu_items ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id   UUID REFERENCES menu_categories(id),
    name          TEXT NOT NULL,
    description   TEXT,
    price_kobo    BIGINT NOT NULL CHECK (price_kobo >= 0),
    image_url     TEXT,
    is_available  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS menu_items_restaurant_idx ON menu_items(restaurant_id);

-- ─── orders ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL REFERENCES auth.users(id),
    restaurant_id    UUID NOT NULL REFERENCES restaurants(id),
    rider_id         UUID REFERENCES auth.users(id),
    subtotal_kobo    BIGINT NOT NULL CHECK (subtotal_kobo >= 0),
    delivery_kobo    BIGINT NOT NULL DEFAULT 50000,
    total_kobo       BIGINT NOT NULL CHECK (total_kobo >= 0),
    status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirmed','preparing','ready','picked_up','delivered','cancelled')),
    idempotency_key  TEXT NOT NULL,
    settlement_id    UUID,
    delivery_address TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS orders_customer_idx    ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_restaurant_idx  ON orders(restaurant_id);
CREATE INDEX IF NOT EXISTS orders_status_idx      ON orders(status);

-- ─── order_items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id  UUID NOT NULL REFERENCES menu_items(id),
    name          TEXT NOT NULL,
    price_kobo    BIGINT NOT NULL,
    quantity      INT  NOT NULL CHECK (quantity >= 1),
    subtotal_kobo BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE restaurants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items    ENABLE ROW LEVEL SECURITY;

-- Restaurants visible to all authenticated users.
CREATE POLICY "restaurants_select" ON restaurants FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "restaurants_insert" ON restaurants FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "restaurants_update" ON restaurants FOR UPDATE TO authenticated USING (owner_id = auth.uid());

-- Menu readable by all; writeable by restaurant owner only.
CREATE POLICY "menu_categories_select" ON menu_categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "menu_categories_write"  ON menu_categories FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_categories.restaurant_id AND r.owner_id = auth.uid()));

CREATE POLICY "menu_items_select" ON menu_items FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "menu_items_write"  ON menu_items FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM restaurants r WHERE r.id = menu_items.restaurant_id AND r.owner_id = auth.uid()));

-- Orders: customer and restaurant owner can see their own orders.
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated
    USING (
        customer_id = auth.uid()
        OR rider_id = auth.uid()
        OR EXISTS (SELECT 1 FROM restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
    );

CREATE POLICY "order_items_select" ON order_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id
        AND (o.customer_id = auth.uid() OR o.rider_id = auth.uid()
             OR EXISTS (SELECT 1 FROM restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid()))));

-- Service role bypasses all RLS.
CREATE POLICY "restaurants_service"     ON restaurants     TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "menu_categories_service" ON menu_categories TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "menu_items_service"      ON menu_items      TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "orders_service"          ON orders          TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "order_items_service"     ON order_items     TO service_role USING (TRUE) WITH CHECK (TRUE);
