-- =============================================================================
-- settlements.funding_source — distinguishes a WALLET-funded escrow (Escrow,
-- debits the payer's own wallet) from an EXTERNALLY-funded one
-- (EscrowExternal, funded by an already-verified external charge such as
-- Paystack; DR provider-clearing / CR escrow, no wallet ever touched).
--
-- Found necessary during a fresh Paystack-checkout rollout to transport
-- ride-hailing: transport's existing generic settlement.Refund(...) call
-- sites (bus/car-hire/logistics/event-transport/parcel/movers/towing/
-- scheduled/mobility_service/service.go's cancel & crash-recovery paths, and
-- restaurant's own cancelAndRefund → refundEscrowOnce) ALWAYS credit the
-- PAYER'S WALLET as their refund mechanism. That is correct for a
-- wallet-funded escrow, but for an EscrowExternal one it would hand a Tier-0
-- customer real spendable wallet balance funded by an external charge —
-- exactly the hazard EscrowExternal exists to avoid. Restaurant's OWN
-- existing cancel path (cancelAndRefund) had this exact latent bug for any
-- Paystack-funded order, undiscovered until the transport port surfaced the
-- pattern.
--
-- This column lets settlement.Refund / settlement.RefundExternal enforce the
-- correct method AT THE SOURCE (fail loud on a mismatch) instead of relying
-- on every call site across every module to remember to check funding source
-- before choosing which refund function to call — defense in depth for
-- modules that haven't been audited for this yet.
-- =============================================================================

BEGIN;

ALTER TABLE settlements ADD COLUMN IF NOT EXISTS funding_source TEXT NOT NULL DEFAULT 'wallet';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'settlements_funding_source_check'
  ) THEN
    ALTER TABLE settlements
      ADD CONSTRAINT settlements_funding_source_check
      CHECK (funding_source IN ('wallet', 'external'));
  END IF;
END $$;

COMMIT;
