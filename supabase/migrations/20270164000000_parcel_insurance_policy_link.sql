-- Follow-up to 20270163000000_parcel_insurance_premium.sql: that migration's
-- flat internal premium (fare+insurance escrowed together, settled 100% to the
-- platform) is being replaced with REAL Goods-in-Transit cover, bound through
-- the existing MyCover-backed policy saga (backend/internal/insurance/policy)
-- once a courier + vehicle are assigned (AcceptParcel), same proven quote->
-- wallet-debit->bind->commission-only-revenue flow /api/finance/insurance/*
-- already uses.
--
-- insurance_kobo now means "indicative estimate shown before booking, read
-- from the live product catalog rate" (see transport.parcelIndicativeInsurance),
-- not a charge — the real premium, once bound, is a SEPARATE wallet debit into
-- the provider-clearing pass-through account, entirely outside the courier
-- fare escrow/settlement. insurance_policy_id links to that bound policy
-- (public.insurance_policy.id) so the parcel and its cover can be traced
-- together and so cancellation can cancel both.
--
-- Additive-only: one nullable column, no FK across module schemas (matches
-- this codebase's existing convention for cross-module references — e.g.
-- parcels.settlement_id has no FK to public.settlements either), no backfill
-- needed since every existing parcel predates real insurance binding.

ALTER TABLE parcels
    ADD COLUMN IF NOT EXISTS insurance_policy_id text;

COMMENT ON COLUMN parcels.insurance_policy_id IS
    'References insurance_policy.id (no cross-module FK, by convention) once '
    'AcceptParcel has successfully bound real MyCover-backed Goods-in-Transit '
    'cover for this parcel. NULL means the parcel ships uninsured — either no '
    'declared value, or the bind was declined/failed (never blocks delivery).';

CREATE INDEX IF NOT EXISTS idx_parcels_insurance_policy_id
    ON parcels (insurance_policy_id) WHERE insurance_policy_id IS NOT NULL;
