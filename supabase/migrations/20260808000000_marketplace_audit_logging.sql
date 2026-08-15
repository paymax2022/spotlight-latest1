-- Marketplace Audit Logging and Real-time Integration
--
-- Adds comprehensive audit trail, metrics tracking, and real-time event logging
-- for marketplace operations (listings, messaging, transactions).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Marketplace Audit Logs Table
-- ─────────────────────────────────────────────────────────────────────────────
-- Immutable log of all marketplace state changes. Used for:
-- - Compliance/audit trail
-- - Admin dashboard activity feed
-- - Debugging merchant disputes
-- - Analytics

CREATE TABLE IF NOT EXISTS marketplace_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What entity was affected
  entity_type VARCHAR(50) NOT NULL, -- 'listing', 'message', 'offer', 'order'
  entity_id UUID NOT NULL,

  -- Who did it
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(50), -- 'buyer', 'seller', 'admin' (denormalized for read efficiency)

  -- What action
  action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE, PUBLISH, ARCHIVE, MESSAGE, OFFER_MADE, ORDER_PLACED

  -- What changed (for UPDATE actions)
  -- {old: {...old values...}, new: {...new values...}}
  changes JSONB DEFAULT '{}',

  -- Request context
  request_id VARCHAR(36),
  ip_address INET,
  user_agent TEXT,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_marketplace_audit_entity ON marketplace_audit_logs(entity_type, entity_id);
CREATE INDEX idx_marketplace_audit_actor ON marketplace_audit_logs(actor_id);
CREATE INDEX idx_marketplace_audit_action ON marketplace_audit_logs(action);
CREATE INDEX idx_marketplace_audit_created ON marketplace_audit_logs(created_at DESC);
CREATE INDEX idx_marketplace_audit_request ON marketplace_audit_logs(request_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Marketplace Metrics Table (for aggregated analytics)
-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-aggregated metrics for fast dashboard queries. Computes hourly rollups
-- from audit_logs, reducing query load on real-time dashboard.

CREATE TABLE IF NOT EXISTS marketplace_metrics (
  id BIGSERIAL PRIMARY KEY,

  -- Period this metric covers (hourly or daily)
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  granularity VARCHAR(10) NOT NULL DEFAULT 'hour', -- 'hour', 'day'

  -- Listing metrics
  new_listings BIGINT NOT NULL DEFAULT 0,
  listings_published BIGINT NOT NULL DEFAULT 0,
  listings_archived BIGINT NOT NULL DEFAULT 0,
  listings_sold BIGINT NOT NULL DEFAULT 0,
  total_active_listings BIGINT NOT NULL DEFAULT 0,

  -- Money metrics (in kobo)
  total_gmv_kobo BIGINT NOT NULL DEFAULT 0, -- Gross Merchandise Value
  avg_listing_price_kobo BIGINT DEFAULT 0,
  median_listing_price_kobo BIGINT DEFAULT 0,

  -- User metrics
  unique_sellers BIGINT NOT NULL DEFAULT 0,
  unique_buyers BIGINT NOT NULL DEFAULT 0,
  new_sellers BIGINT NOT NULL DEFAULT 0,

  -- Message metrics
  messages_sent BIGINT NOT NULL DEFAULT 0,
  unique_conversations BIGINT NOT NULL DEFAULT 0,

  -- Offer/Order metrics
  offers_made BIGINT NOT NULL DEFAULT 0,
  orders_placed BIGINT NOT NULL DEFAULT 0,
  order_completion_rate NUMERIC(5,2) DEFAULT 0, -- percentage

  -- Category breakdown (JSON for flexibility)
  category_breakdown JSONB DEFAULT '{}', -- {category: {count, gmv}}

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_marketplace_metrics_period ON marketplace_metrics(period_start DESC, granularity);
CREATE INDEX idx_marketplace_metrics_date ON marketplace_metrics((DATE(period_start)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Real-time Activity Stream (for admin live dashboard)
-- ─────────────────────────────────────────────────────────────────────────────
-- High-speed FIFO buffer of recent events. Kept small (configurable retention)
-- and used for admin live activity feed. Built from audit_logs on-write.

CREATE TABLE IF NOT EXISTS marketplace_activity_stream (
  id BIGSERIAL PRIMARY KEY,

  -- Event details (denormalized from audit_logs)
  event_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  actor_id UUID NOT NULL,

  -- Enriched data for display
  display_text TEXT NOT NULL, -- "John posted: iPhone 14 for ₦500,000"
  listing_title VARCHAR(255),
  listing_price_kobo BIGINT,
  actor_name VARCHAR(255),

  severity VARCHAR(20) DEFAULT 'info', -- 'info', 'warning', 'error'

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_stream_created ON marketplace_activity_stream(created_at DESC);
CREATE INDEX idx_activity_stream_entity ON marketplace_activity_stream(entity_type, entity_id);

-- Retention: keep only last 7 days (configurable per deployment)
CREATE OR REPLACE FUNCTION cleanup_old_activity_stream()
RETURNS void AS $$
BEGIN
  DELETE FROM marketplace_activity_stream
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Function: Log Marketplace Action
-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic function that:
-- 1. Writes audit log (immutable)
-- 2. Publishes to activity stream (for live admin feed)
-- 3. Triggers metrics update (via NOTIFY for async processing)

CREATE OR REPLACE FUNCTION log_marketplace_action(
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_actor_id UUID,
  p_action VARCHAR,
  p_changes JSONB DEFAULT '{}'::JSONB,
  p_request_id VARCHAR DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_display_text TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
  v_actor_role VARCHAR;
BEGIN
  -- Get actor's role (denormalize for perf)
  SELECT role INTO v_actor_role FROM auth.users WHERE id = p_actor_id LIMIT 1;

  -- 1. Insert immutable audit log
  INSERT INTO marketplace_audit_logs (
    entity_type, entity_id, actor_id, actor_role, action, changes,
    request_id, ip_address, user_agent, created_at
  )
  VALUES (
    p_entity_type, p_entity_id, p_actor_id, v_actor_role, p_action, p_changes,
    p_request_id, p_ip_address, p_user_agent, NOW()
  )
  RETURNING id INTO v_log_id;

  -- 2. Append to activity stream (for live admin dashboard)
  IF p_display_text IS NOT NULL THEN
    INSERT INTO marketplace_activity_stream (
      event_type, entity_type, entity_id, actor_id,
      display_text, actor_name, severity, created_at
    )
    VALUES (
      p_action, p_entity_type, p_entity_id, p_actor_id,
      p_display_text, COALESCE((SELECT display_name FROM auth.users WHERE id = p_actor_id), 'User'),
      CASE WHEN p_action IN ('DELETE', 'ARCHIVE') THEN 'warning' ELSE 'info' END,
      NOW()
    );
  END IF;

  -- 3. Trigger metrics update via NOTIFY (async)
  PERFORM pg_notify('marketplace_action', json_build_object(
    'action', p_action,
    'entity_type', p_entity_type,
    'timestamp', NOW()::TEXT
  )::TEXT);

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Function: Get Audit Trail for Entity
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_audit_trail(
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_limit INT DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  action VARCHAR,
  actor_id UUID,
  changes JSONB,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    audit.id,
    audit.action,
    audit.actor_id,
    audit.changes,
    audit.created_at
  FROM marketplace_audit_logs audit
  WHERE audit.entity_type = p_entity_type
    AND audit.entity_id = p_entity_id
  ORDER BY audit.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Function: Get Real-time Metrics (for admin dashboard)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_realtime_marketplace_metrics()
RETURNS TABLE (
  total_active_listings BIGINT,
  listings_created_today BIGINT,
  total_gmv_kobo BIGINT,
  unique_sellers_today BIGINT,
  unique_buyers_today BIGINT,
  messages_sent_today BIGINT,
  offers_made_today BIGINT,
  recent_activity_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM marketplace_listings WHERE status = 'PUBLISHED')::BIGINT,
    (SELECT COUNT(*) FROM marketplace_audit_logs WHERE action = 'CREATE' AND entity_type = 'listing' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COALESCE(SUM((changes->'new'->>'price_kobo')::BIGINT), 0) FROM marketplace_audit_logs WHERE action = 'PUBLISH' AND entity_type = 'listing' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(DISTINCT actor_id) FROM marketplace_audit_logs WHERE entity_type = 'listing' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(DISTINCT actor_id) FROM marketplace_audit_logs WHERE entity_type = 'message' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(*) FROM marketplace_audit_logs WHERE entity_type = 'message' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(*) FROM marketplace_audit_logs WHERE entity_type = 'offer' AND DATE(created_at) = CURRENT_DATE)::BIGINT,
    (SELECT COUNT(*) FROM marketplace_activity_stream WHERE DATE(created_at) = CURRENT_DATE)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Views for Common Queries
-- ─────────────────────────────────────────────────────────────────────────────

-- Admin activity dashboard
CREATE OR REPLACE VIEW marketplace_admin_activity AS
SELECT
  stream.id,
  stream.event_type,
  stream.entity_type,
  stream.entity_id,
  stream.actor_id,
  stream.display_text,
  stream.listing_title,
  stream.listing_price_kobo,
  stream.actor_name,
  stream.severity,
  stream.created_at,
  age(NOW(), stream.created_at) as time_ago
FROM marketplace_activity_stream stream
ORDER BY stream.created_at DESC
LIMIT 100;

-- Audit trail search
CREATE OR REPLACE VIEW marketplace_audit_search AS
SELECT
  id,
  entity_type,
  entity_id,
  actor_id,
  action,
  changes,
  created_at,
  DATE(created_at) as action_date
FROM marketplace_audit_logs
ORDER BY created_at DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Grant Permissions
-- ─────────────────────────────────────────────────────────────────────────────

-- Only authenticated users can read audit logs (scoped by row-level security)
GRANT SELECT ON marketplace_audit_logs TO authenticated;
GRANT SELECT ON marketplace_activity_stream TO authenticated;
GRANT SELECT ON marketplace_metrics TO authenticated;

-- Only admin can write (through backend service layer)
GRANT SELECT, INSERT ON marketplace_audit_logs TO postgres; -- Used by backend
GRANT SELECT, INSERT ON marketplace_activity_stream TO postgres;
GRANT SELECT, UPDATE ON marketplace_metrics TO postgres;

-- Functions are security definer, so users call them securely
GRANT EXECUTE ON FUNCTION log_marketplace_action TO authenticated;
GRANT EXECUTE ON FUNCTION get_audit_trail TO authenticated;
GRANT EXECUTE ON FUNCTION get_realtime_marketplace_metrics TO authenticated;

-- Views
GRANT SELECT ON marketplace_admin_activity TO authenticated;
GRANT SELECT ON marketplace_audit_search TO authenticated;
