-- Restate the pricing option labels in the operator's exact format, e.g.
-- "Weekend - Saturday & Sunday (No Boarding)". Same five formats apply to
-- every area of interest; prices are unchanged. Mirrors
-- frontend-web/src/server/services/academy/pricing.ts.

UPDATE academy_area_pricing_options SET
  label = 'Weekend - Saturday & Sunday (No Boarding)',
  note  = NULL
WHERE key = 'weekend_day';

UPDATE academy_area_pricing_options SET
  label = 'Weekend - Saturday & Sunday (With Boarding)',
  note  = NULL
WHERE key = 'weekend_boarding';

UPDATE academy_area_pricing_options SET
  label = 'Week days - Mondays - Fridays (No Boarding)',
  note  = NULL
WHERE key = 'weekday_day';

UPDATE academy_area_pricing_options SET
  label = 'Week days - Mondays - Fridays (Boarding)',
  note  = NULL
WHERE key = 'weekday_boarding';

UPDATE academy_area_pricing_options SET
  label = '1 month (30 days) with Boarding',
  note  = 'For non Lagos residents'
WHERE key = 'full_time_boarding';
