-- Additive: mover_bids has never carried a crew_size column, but the admin
-- mobility console's MoverBid type (frontend-admin/src/types/mobilityModes.ts)
-- has always rendered one — it came from that page's mock dataset, not a real
-- column. The driver-facing bid endpoint (MoverBidRequest / SubmitMoverBid in
-- backend/internal/transport/movers.go) still doesn't collect a crew size at
-- bid time, so every row lands on the default below until that flow is wired.
-- Adding the column now lets the new admin mover-detail endpoint return a real
-- (if currently uniform) value instead of fabricating one per row.
ALTER TABLE mover_bids
    ADD COLUMN IF NOT EXISTS crew_size INTEGER NOT NULL DEFAULT 1 CHECK (crew_size > 0);
