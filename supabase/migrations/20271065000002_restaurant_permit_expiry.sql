-- FOOD-UAT-H-002: business-permit expiry + compliance hold. Additive-only.
-- NULL permit_expires_at = no permit on file: the store cannot be opened until an
-- admin records one (PUT /restaurant/admin/:id/permit).
BEGIN;
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS permit_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS permit_document_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS compliance_hold_reason TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_restaurants_permit_expires_at
  ON public.restaurants (permit_expires_at) WHERE permit_expires_at IS NOT NULL;
COMMIT;
