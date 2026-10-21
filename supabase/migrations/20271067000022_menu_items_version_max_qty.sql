-- FOOD-UAT-B-006 / B-008 (additive only).
--   version            optimistic-concurrency token for menu edits (compare-and-set).
--   max_qty_per_order  seller-configured per-line cap; NULL falls back to the global cap.
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS max_qty_per_order INT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_max_qty_per_order_pos') THEN
    ALTER TABLE menu_items ADD CONSTRAINT menu_items_max_qty_per_order_pos
      CHECK (max_qty_per_order IS NULL OR max_qty_per_order >= 1);
  END IF;
END $$;

-- FOOD-UAT-B-009: timed pause. While paused_until is in the future the store takes no new
-- orders; is_open is left alone so resuming never bypasses the KYB / permit gates.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS paused_until TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_restaurants_paused_until ON restaurants (paused_until) WHERE paused_until IS NOT NULL;
