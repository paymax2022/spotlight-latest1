-- Paymax Connect — subscription billing cycle (PAY-006: auto-renew, cancel, proration)
-- Ref: Spotlight_Connect_Test_Plan TS-8 PAY-006.
--
-- Adds the billing-cycle fields the renewal/cancel logic needs on the entitlement
-- projection. current period = [granted_at, expires_at]; next billing = expires_at.
--
-- Additive-only: ADD COLUMN IF NOT EXISTS with safe defaults. Existing subscription
-- entitlements default to auto_renew=true (they were bought to renew) and
-- canceled_at=NULL (not cancelled). No column dropped/renamed/narrowed.

BEGIN;

ALTER TABLE public.connect_entitlements
  ADD COLUMN IF NOT EXISTS auto_renew  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz;

-- Index the renewal batch's selection predicate: active auto-renewing subs due to bill.
CREATE INDEX IF NOT EXISTS connect_entitlements_renewal_due_idx
  ON public.connect_entitlements (expires_at)
  WHERE active AND auto_renew AND kind = 'subscription' AND canceled_at IS NULL;

COMMIT;
