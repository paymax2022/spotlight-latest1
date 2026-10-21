-- PENDING (lane estate-d, UAT EST-UAT-0359 / ESTD-D008): inbox archive + retention.
-- Additive-only. Apply + renumber at consolidation.
ALTER TABLE estate_notifications ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_notifications_user_active
    ON estate_notifications (user_id, created_at DESC) WHERE archived_at IS NULL;
