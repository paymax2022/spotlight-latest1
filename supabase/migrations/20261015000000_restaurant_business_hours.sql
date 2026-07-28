-- Restaurant / Delivery — weekly business hours (Phase 5, additive-only).
--
-- A restaurant's opening schedule as recurring weekly windows. The order path gates on
-- effective-open = is_open (manual switch / merchant-active) AND (no rows ⇒ open, else
-- within a window). A restaurant with NO rows is unaffected — it keeps ordering purely
-- off is_open, exactly as before this feature (back-compat).
--
-- Minutes-from-midnight, local (Africa/Lagos). close_minute > open_minute is a same-day
-- window; close_minute < open_minute is an OVERNIGHT window spilling into the next day
-- (e.g. 18:00 → 02:00). Equal is disallowed (zero-length). Multiple rows per weekday =
-- split shifts (lunch + dinner). No DROP / RENAME / type narrowing.

CREATE TABLE IF NOT EXISTS restaurant_business_hours (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday … 6 = Saturday (Go time.Weekday)
    open_minute   INT NOT NULL CHECK (open_minute  BETWEEN 0 AND 1439),
    close_minute  INT NOT NULL CHECK (close_minute BETWEEN 1 AND 1440),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT restaurant_business_hours_nonzero CHECK (open_minute <> close_minute)
);
CREATE INDEX IF NOT EXISTS restaurant_business_hours_restaurant_idx
    ON restaurant_business_hours (restaurant_id);

ALTER TABLE restaurant_business_hours ENABLE ROW LEVEL SECURITY;
-- Hours are public catalog data (clients render "open now" + the weekly schedule); the
-- Go service performs all writes with an owner check, so no write policy is granted.
CREATE POLICY "restaurant_business_hours_select" ON restaurant_business_hours
    FOR SELECT TO authenticated USING (TRUE);
