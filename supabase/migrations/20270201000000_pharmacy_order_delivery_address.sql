-- Pharmacy orders never captured a per-order delivery address/coordinate, so
-- patientDropoff() (backend/internal/app/health_pharmacy_routes.go) always
-- returned ok=false and every DELIVERY-fulfilment order permanently failed at
-- Dispatch (fail-closed rather than routing to a 0,0 placeholder). This is the
-- schema seam that comment already names as the single thing needed to wire it.
-- Additive only: nullable, no existing row is affected. PICKUP orders leave
-- these null.
ALTER TABLE public.pharmacy_orders
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_lat      double precision,
  ADD COLUMN IF NOT EXISTS delivery_lng      double precision;
