-- Parcel insurance paid AT BOOKING (opt-in), held until the policy binds.
--
-- ADDITIVE-ONLY.
--
-- 1. ledger_accounts.type admits `insurance_premium_hold`: the standing account
--    a parcel's Goods-in-Transit premium sits in between booking (customer
--    pays fare + premium) and courier accept (the policy is bound with the
--    insurer). From there it moves to provider_clearing on bind, or back to
--    the customer's wallet when cover cannot be bound or the parcel is
--    cancelled. It never enters the courier settlement (the fare escrow).
--    Widened as (EXISTING CHECK) OR type = 'insurance_premium_hold', read from
--    the live constraint rather than a hard-coded list, so it can never narrow
--    what another migration admitted (other branches widen the same CHECK, and
--    a re-listed ARRAY silently drops whatever the author did not know about).
--    Idempotent; no-op if the type is already admitted.
--
-- 2. parcels gains the opt-in and payment state of that premium:
--    insurance_opted          the sender ticked "insure this parcel"
--    insurance_paid_kobo      premium the sender paid at booking (integer kobo).
--                             The platform absorbs any difference from the
--                             insurer's real premium, so this never changes.
--    insurance_status         none (legacy: booked before this, keeps the old
--                             bind-and-debit at courier accept) | declined (could
--                             have ticked, did not) | held | binding | bound |
--                             refunded | refund_failed
--    Existing rows default to (false, 0, 'none'): legacy parcels are untouched.

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
  WHERE conname = 'ledger_accounts_type_check' AND conrelid = 'public.ledger_accounts'::regclass;
  def := regexp_replace(def, '\s+NOT VALID$', '');
  IF def IS NOT NULL AND position('insurance_premium_hold' in def) = 0 THEN
    -- def is 'CHECK (<expr>)'; substr(def, 7) is '(<expr>)'.
    EXECUTE 'ALTER TABLE public.ledger_accounts DROP CONSTRAINT ledger_accounts_type_check';
    EXECUTE 'ALTER TABLE public.ledger_accounts ADD CONSTRAINT ledger_accounts_type_check CHECK ('
      || substr(def, 7) || ' OR type = ''insurance_premium_hold'')';
  END IF;
END $$;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS insurance_opted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_paid_kobo bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_status text NOT NULL DEFAULT 'none';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_insurance_paid_kobo_check') THEN
    ALTER TABLE public.parcels ADD CONSTRAINT parcels_insurance_paid_kobo_check CHECK (insurance_paid_kobo >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_insurance_status_check') THEN
    ALTER TABLE public.parcels ADD CONSTRAINT parcels_insurance_status_check
      CHECK (insurance_status IN ('none','declined','held','binding','bound','refunded','refund_failed'));
  END IF;
END $$;

COMMENT ON COLUMN public.parcels.insurance_paid_kobo IS
  'Goods-in-Transit premium the sender paid at booking (kobo). Held in the insurance_premium_hold ledger account until bind or refund.';
COMMENT ON COLUMN public.parcels.insurance_status IS
  'none (legacy flow) | declined (not ticked) | held (paid, awaiting bind) | binding (bind in progress) | bound (policy active) | refunded | refund_failed (needs reconciliation)';

-- Reconciliation: premiums still held, or refunds that failed.
CREATE INDEX IF NOT EXISTS idx_parcels_insurance_status_open
  ON public.parcels (insurance_status) WHERE insurance_status IN ('held','binding','refund_failed');
