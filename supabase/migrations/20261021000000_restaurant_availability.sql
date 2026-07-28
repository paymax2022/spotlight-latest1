-- Restaurant / Delivery — availability completeness (Phase 11, additive-only).
--   * prep_time_minutes  → folded into the delivery ETA (AV-004).
--   * accept_sla_minutes  → auto-cancel+refund of never-accepted orders (AV-007; 0 = off).
--   * restaurant_holiday_hours → per-date overrides of the weekly schedule (AV-005).
-- No DROP / RENAME / type narrowing; every existing restaurant is unaffected (defaults).

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS prep_time_minutes INT NOT NULL DEFAULT 15
    CHECK (prep_time_minutes BETWEEN 0 AND 240);
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS accept_sla_minutes INT NOT NULL DEFAULT 0
    CHECK (accept_sla_minutes BETWEEN 0 AND 1440); -- 0 disables the accept-SLA sweeper

-- Per-date override of the weekly business hours. A row for a date REPLACES the weekly
-- schedule for that date: is_closed=true ⇒ shut all day; else the single [open,close)
-- window applies. open/close are minutes-from-midnight, matching restaurant_business_hours.
CREATE TABLE IF NOT EXISTS restaurant_holiday_hours (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    holiday_date  DATE NOT NULL,
    is_closed     BOOLEAN NOT NULL DEFAULT TRUE,
    open_minute   INT CHECK (open_minute IS NULL OR open_minute BETWEEN 0 AND 1439),
    close_minute  INT CHECK (close_minute IS NULL OR close_minute BETWEEN 1 AND 1440),
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (restaurant_id, holiday_date)
);
CREATE INDEX IF NOT EXISTS restaurant_holiday_hours_rest_idx ON restaurant_holiday_hours(restaurant_id, holiday_date);

ALTER TABLE restaurant_holiday_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "restaurant_holiday_hours_read" ON restaurant_holiday_hours FOR SELECT TO authenticated USING (TRUE);
