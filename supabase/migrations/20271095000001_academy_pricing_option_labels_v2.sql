-- Second restatement of the pricing option labels, to the operator's shorter
-- format: "Weekend (No Boarding)", "1 month - Boarding", etc. Prices unchanged.
-- Mirrors frontend-web/src/server/services/academy/pricing.ts.

UPDATE academy_area_pricing_options SET label = 'Weekend (No Boarding)',   note = NULL WHERE key = 'weekend_day';
UPDATE academy_area_pricing_options SET label = 'Weekend (With Boarding)', note = NULL WHERE key = 'weekend_boarding';
UPDATE academy_area_pricing_options SET label = 'Week days (No Boarding)', note = NULL WHERE key = 'weekday_day';
UPDATE academy_area_pricing_options SET label = 'Week days (Boarding)',    note = NULL WHERE key = 'weekday_boarding';
UPDATE academy_area_pricing_options SET label = '1 month - Boarding',      note = NULL WHERE key = 'full_time_boarding';
