-- Per-item preparation time. NULL means "use the restaurant's default", so existing
-- items keep the restaurant-wide behaviour with no backfill.
--
-- ADDITIVE-ONLY: one nullable column and a check.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS prep_time_minutes INT
    CHECK (prep_time_minutes IS NULL OR prep_time_minutes BETWEEN 5 AND 180);
