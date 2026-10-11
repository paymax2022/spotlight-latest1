-- Marketplace alert producers: new-listing-from-followed-seller + saved-item price drop.
--
-- ADDITIVE-ONLY. Safe to re-run.
--   * mkt_notification_type gains 'new_listing' (price_dropped already exists).
--   * mkt_notifications.dedupe_key + a partial UNIQUE (user_id, dedupe_key) make the
--     fan-out idempotent: a retried/replayed producer INSERTs ... ON CONFLICT DO NOTHING
--     and never double-notifies. NULL keys (every pre-existing producer) are unconstrained.
--   * mkt_notification_prefs.new_listing — opt-out toggle for followed-seller listing
--     alerts (default on, matching the table's "all on except promotional" posture).

ALTER TYPE mkt_notification_type ADD VALUE IF NOT EXISTS 'new_listing';

ALTER TABLE mkt_notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_notifications_dedupe
  ON mkt_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

ALTER TABLE mkt_notification_prefs ADD COLUMN IF NOT EXISTS new_listing BOOLEAN NOT NULL DEFAULT true;

-- Block lookups from the fan-out filter on blocked_user_id too.
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON mkt_blocks(blocked_user_id, user_id);
