-- Restaurant / Delivery — menu & cart completeness (Phase 12, additive-only).
--   * menu_items.dietary_tags  → allergen/dietary labels (MN-009), drives DS-003 filter.
--   * restaurants.min_order_kobo → minimum order value gate (CT-007).
--   * orders.special_instructions → sanitized per-order note (CT-009).
-- Item price upper-bound (MN-004) is enforced in the service layer (a DB CHECK could
-- reject pre-existing rows). No DROP / RENAME / type narrowing.

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS dietary_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS min_order_kobo BIGINT NOT NULL DEFAULT 0
    CHECK (min_order_kobo >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_instructions TEXT;

-- GIN index so the discovery dietary filter (dietary_tags && ARRAY[...]) is indexed.
CREATE INDEX IF NOT EXISTS menu_items_dietary_tags_idx ON menu_items USING gin (dietary_tags);
