-- Estate super-app — hot-path index hardening (Block 47c).
-- Additive only (CREATE INDEX IF NOT EXISTS). No DROP/ALTER/narrowing.
--
-- The 20260622010000 migration indexes the estate-scoped LIST paths. These add
-- indexes for the remaining hot query paths exercised by the /api/v1/estate/*
-- handlers, identified by the static RLS/index audit
-- (docs/estate/SECURITY-RLS-INDEX-AUDIT.md):
--   - getMeetingMinutes / ai-notes generate → meeting_minutes WHERE meeting_id = …
--   - getRepair / addRepairUpdate          → repair_updates  WHERE request_id = …
--   - listMyBookings                       → facility_bookings WHERE estate_id = … AND resident_id = …
--   - listFacilities                       → estate_facilities WHERE estate_id = …
--   - listVendors                          → estate_vendors    WHERE estate_id = …

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting ON meeting_minutes (meeting_id);
CREATE INDEX IF NOT EXISTS idx_repair_updates_request  ON repair_updates (request_id);
CREATE INDEX IF NOT EXISTS idx_bookings_resident       ON facility_bookings (estate_id, resident_id);
CREATE INDEX IF NOT EXISTS idx_facilities_estate       ON estate_facilities (estate_id);
CREATE INDEX IF NOT EXISTS idx_vendors_estate          ON estate_vendors (estate_id);
