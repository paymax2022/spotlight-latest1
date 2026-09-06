-- Additive-only: adds a new boost_status value so a seller can cancel their
-- own active boost (prorated refund on the unused days), distinct from the
-- existing admin-only 'rejected_with_reason' (a policy violation) — same
-- terminal 'auto_refunded' destination, different reason for getting there.
ALTER TYPE boost_status ADD VALUE IF NOT EXISTS 'cancelled_by_seller';
