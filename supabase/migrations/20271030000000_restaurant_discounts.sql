-- Restaurant discounts: owner-set price reductions on items, categories or the whole
-- restaurant, active for a window. Automatic, shown with the item; separate from the
-- coupon system in restaurant_promos, which needs a code at checkout.
--
-- ADDITIVE-ONLY: new tables, and nullable columns on order_items.

CREATE TABLE IF NOT EXISTS restaurant_discounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind              TEXT NOT NULL CHECK (kind IN ('PERCENT','FIXED')),
  value             BIGINT NOT NULL CHECK (value > 0),
  scope             TEXT NOT NULL CHECK (scope IN ('ITEM','CATEGORY','RESTAURANT')),
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  max_discount_kobo BIGINT CHECK (max_discount_kobo IS NULL OR max_discount_kobo > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (kind <> 'PERCENT' OR value BETWEEN 1 AND 90)
);

CREATE INDEX IF NOT EXISTS restaurant_discounts_live_idx
  ON restaurant_discounts (restaurant_id, is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS restaurant_discount_items (
  discount_id  UUID NOT NULL REFERENCES restaurant_discounts(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, menu_item_id)
);

CREATE TABLE IF NOT EXISTS restaurant_discount_categories (
  discount_id          UUID NOT NULL REFERENCES restaurant_discounts(id) ON DELETE CASCADE,
  taxonomy_category_id UUID NOT NULL REFERENCES restaurant_taxonomy_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (discount_id, taxonomy_category_id)
);

-- The line keeps the discount it was priced with, so a later edit or pause never
-- rewrites history.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS discount_id UUID REFERENCES restaurant_discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_kobo BIGINT NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0);

ALTER TABLE restaurant_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_discount_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_discount_categories ENABLE ROW LEVEL SECURITY;
