-- Reconcile central commission_config rates to each module's ACTUAL live take-rate,
-- so the profit dashboard reflects real earnings rather than the workbook's uniform
-- 10% placeholder. Rates remain admin-adjustable in /admin/commission afterwards.
-- Config is mutable-by-design (only commission_earnings is append-only), so UPDATE
-- is allowed here. Idempotent. ADDITIVE (no schema change).

-- Transport / mobility: settlement split charges the STANDARD tier 20%
-- (low 12% / fleet 15% vary per driver context; 20% is the representative headline
-- rate — tune per service in admin if a mode's blended rate differs).
UPDATE public.commission_config
SET platform_charge_bps = 2000,
    notes = COALESCE(notes,'') || ' [reconciled to transport standard-tier 20%]',
    updated_at = now()
WHERE service_category = 'Lifestyle'
  AND service IN ('Taxi - Ride Hailing', 'Delivery - Rider', 'Bus Booking', 'Car Hire')
  AND service_subtype = ''
  AND platform_charge_bps <> 2000;

-- Stays (hotels/shortlets): Rail-B direct commission 15% (Rail-A markup ~12%).
UPDATE public.commission_config
SET platform_charge_bps = 1500,
    notes = COALESCE(notes,'') || ' [reconciled to stays Rail-B 15%]',
    updated_at = now()
WHERE service_category = 'Property'
  AND service = 'Hotel'
  AND service_subtype = ''
  AND platform_charge_bps <> 1500;
