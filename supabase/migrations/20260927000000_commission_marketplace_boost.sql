-- Dedicated commission config for marketplace BOOST (promoted-listing ad) sales.
-- A boost is a 100%-platform ad sale, not a marketplace order, so the whole price
-- is Spotlight revenue — distinct from the generic Lifestyle/Marketplace 10%
-- take-rate. The marketplace boost path records earnings under this 'boost'
-- subtype (see backend/internal/marketplace/service_boost.go). ADDITIVE ONLY.
INSERT INTO public.commission_config
  (service_category, service, service_subtype, fee_model, commission_bps, platform_charge_bps, convenience_fee_kobo, fixed_fee_kobo, fee_payer, notes)
VALUES
  ('Lifestyle', 'Marketplace', 'boost', 'platform_charge', 0, 10000, 0, 0, 'merchant',
   'Promoted-listing ad sale — full price is Spotlight revenue.')
ON CONFLICT (service_category, service, service_subtype) DO NOTHING;
