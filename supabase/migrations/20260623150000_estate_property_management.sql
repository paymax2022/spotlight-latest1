-- Block 29: estate property management.
--
-- Adds an archive flag to properties (soft-retire without deleting history) and a
-- property transfer-request workflow (resident requests ownership/tenancy change,
-- estate admin approves/rejects). Additive-only: a nullable-defaulted column plus
-- a new table; no changes to existing objects.

ALTER TABLE estate_properties
    ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS property_transfer_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id   UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    requested_by  UUID NOT NULL REFERENCES auth.users(id),
    to_user_id    UUID NOT NULL REFERENCES auth.users(id),
    transfer_type TEXT NOT NULL CHECK (transfer_type IN ('ownership','tenancy')),
    reason        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewed_by   UUID REFERENCES auth.users(id),
    reviewed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_transfers_estate ON property_transfer_requests (estate_id, status);
CREATE INDEX IF NOT EXISTS idx_property_transfers_property ON property_transfer_requests (property_id);
