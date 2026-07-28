-- ── Property Management suite — realtor↔estate link (stay→gate-pass bridge) ───
-- Additive-only (nullable columns, no DROP / rename / type narrowing). Models the
-- "this realtor unit physically sits inside a gated estate" relationship so that a
-- confirmed shortlet/hotel booking can auto-issue an estate visitor gate pass for
-- the guest covering the stay dates (cross-cutting flow #4 — the moat flow).
--
-- estate_id is resolved by the bridge as: booking.estate_id (explicit per-booking
-- override) first, else the unit's estate_id (the durable physical link). When both
-- are NULL the unit is not in a managed estate and pass issuance is skipped
-- gracefully.

ALTER TABLE realtor_units
    ADD COLUMN IF NOT EXISTS estate_id UUID REFERENCES estates(id) ON DELETE SET NULL;

ALTER TABLE realtor_shortlet_bookings
    ADD COLUMN IF NOT EXISTS estate_id UUID REFERENCES estates(id) ON DELETE SET NULL;

-- Records which estate visitor pass (if any) was auto-issued for a booking, so the
-- bridge is idempotent (one pass per booking) and the gate-pass endpoint can return
-- it. Nullable FK; SET NULL keeps the booking row if the pass is later purged.
ALTER TABLE realtor_shortlet_bookings
    ADD COLUMN IF NOT EXISTS estate_pass_id UUID REFERENCES visitor_passes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_realtor_units_estate
    ON realtor_units(estate_id) WHERE estate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_realtor_shortlet_estate
    ON realtor_shortlet_bookings(estate_id) WHERE estate_id IS NOT NULL;
