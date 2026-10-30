-- Parcel proof-of-delivery admin review (additive only).
-- The admin console derived pod_status from status + proof_url and had no
-- review action. These columns record an explicit, audited admin decision;
-- NULL pod_review_status means "not reviewed" and the derived value applies.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pod_review_status TEXT
    CHECK (pod_review_status IS NULL OR pod_review_status IN ('approved','rejected'));
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pod_reviewed_by UUID;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pod_reviewed_at TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS pod_review_reason TEXT;
