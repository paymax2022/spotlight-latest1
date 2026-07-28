-- Restaurant / Delivery — review moderation (Phase 16, additive-only, RV-004).
-- Adds a moderation state to restaurant_ratings so abusive reviews can be flagged/hidden;
-- hidden reviews are excluded from public reads AND from the star average. No DROP /
-- RENAME / type narrowing.

ALTER TABLE restaurant_ratings ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible'
    CHECK (moderation_status IN ('visible','flagged','hidden'));
CREATE INDEX IF NOT EXISTS restaurant_ratings_moderation_idx ON restaurant_ratings(restaurant_id, moderation_status);
