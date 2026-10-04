-- Owner-scoped write policies for the realtor property-graph child tables.
-- realtor_portfolios already has "Owner manages own portfolio" (FOR ALL,
-- owner_id = auth.uid()); the child tables got RLS enabled but no policies,
-- so every owner write (property/unit/offering-mode create, hotel room-board
-- and channel ops) is denied for anon AND authenticated callers — the mobile
-- owner flows were dead-on-arrival.
-- Policies scope writes to rows reachable through the owner's portfolio —
-- same rule as the existing portfolio policy. Admin moderation of
-- realtor_listings stays backend-only (Go /api/realtor/admin, service role).
-- Additive only; idempotent via DROP POLICY IF EXISTS.

BEGIN;

DROP POLICY IF EXISTS "Owner manages own properties" ON realtor_properties;
CREATE POLICY "Owner manages own properties"
    ON realtor_properties FOR ALL
    USING (portfolio_id IN (
        SELECT id FROM realtor_portfolios WHERE owner_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Owner manages own units" ON realtor_units;
CREATE POLICY "Owner manages own units"
    ON realtor_units FOR ALL
    USING (property_id IN (
        SELECT p.id FROM realtor_properties p
        JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
        WHERE pf.owner_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Owner manages own offering modes" ON realtor_offering_modes;
CREATE POLICY "Owner manages own offering modes"
    ON realtor_offering_modes FOR ALL
    USING (unit_id IN (
        SELECT u.id FROM realtor_units u
        JOIN realtor_properties p  ON p.id = u.property_id
        JOIN realtor_portfolios pf ON pf.id = p.portfolio_id
        WHERE pf.owner_id = auth.uid()
    ));

-- Hotel desk ops are owner-scoped the same way: the portfolio owner manages
-- their own hotel's room board and channel connections. A finer staff-level
-- split does not exist in the schema (no staff table) — owners only.
DROP POLICY IF EXISTS "Owner manages own hotel rooms" ON realtor_hotel_rooms;
CREATE POLICY "Owner manages own hotel rooms"
    ON realtor_hotel_rooms FOR ALL
    USING (hotel_id IN (
        SELECT h.id FROM realtor_hotels h
        JOIN realtor_portfolios pf ON pf.id = h.portfolio_id
        WHERE pf.owner_id = auth.uid()
    ));

DROP POLICY IF EXISTS "Owner manages own channels" ON realtor_channel_connections;
CREATE POLICY "Owner manages own channels"
    ON realtor_channel_connections FOR ALL
    USING (hotel_id IN (
        SELECT h.id FROM realtor_hotels h
        JOIN realtor_portfolios pf ON pf.id = h.portfolio_id
        WHERE pf.owner_id = auth.uid()
    ));

-- The guest policy is the only one on reservations, so an owner reading their
-- own hotel's arrivals/desk summary sees nothing. Add owner read visibility;
-- writes stay guest-scoped (status transitions are booking-owner or backend).
DROP POLICY IF EXISTS "Owner sees own hotel reservations" ON realtor_hotel_reservations;
CREATE POLICY "Owner sees own hotel reservations"
    ON realtor_hotel_reservations FOR SELECT
    USING (hotel_id IN (
        SELECT h.id FROM realtor_hotels h
        JOIN realtor_portfolios pf ON pf.id = h.portfolio_id
        WHERE pf.owner_id = auth.uid()
    ));

COMMIT;
